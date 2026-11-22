/*
 * Coaching Catalyst - Main Branch CI/CD Pipeline (Pipeline from SCM)
 *
 * Downstream forks should configure:
 * - IMAGE_REPOSITORY: internal OCI registry path
 * - Jenkins credentials: container-registry-credentials, kubeconfig-staging, kubeconfig-prod
 * - Application secrets in HashiCorp Vault (never in Jenkins or Helm --set; see helm/README.md)
 */

pipeline {
  agent { label 'linux && node24 && docker && helm' }

  options {
    timestamps()
    ansiColor('xterm')
    disableConcurrentBuilds()
    timeout(time: 45, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '60', artifactNumToKeepStr: '30'))
  }

  parameters {
    booleanParam(
      name: 'DEPLOY_TO_STAGING',
      defaultValue: true,
      description: 'Deploy the verified image to staging via Helm after all gates pass.'
    )
    booleanParam(
      name: 'DEPLOY_TO_PRODUCTION',
      defaultValue: false,
      description: 'Prompt for manual approval and deploy to production via Helm.'
    )
    string(
      name: 'IMAGE_REPOSITORY',
      defaultValue: 'ghcr.io/your-org/coaching-catalyst',
      description: 'Target OCI repository for the single-deployable container image.'
    )
  }

  environment {
    CI = 'true'
    PNPM_HOME = "${WORKSPACE}/.pnpm-home"
    PATH = "${PNPM_HOME}:${PATH}"
    HELM_CHART_PATH = 'helm/coaching-catalyst'
    HELM_RELEASE_NAME = 'coaching-catalyst'
    STAGING_NAMESPACE = 'coaching-catalyst-staging'
    PROD_NAMESPACE = 'coaching-catalyst-prod'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
        script {
          env.IMAGE_TAG = "sha-${sh(script: 'git rev-parse --short=12 HEAD', returnStdout: true).trim()}"
        }
      }
    }

    stage('Setup Toolchain') {
      steps {
        sh '''
          npm install --global --no-fund --no-audit "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")"
          node --version
          pnpm --version
        '''
      }
    }

    stage('Install Dependencies') {
      steps {
        sh 'pnpm install --frozen-lockfile'
      }
    }

    stage('Quality Gates & Formal Proofs') {
      steps {
        sh 'pnpm check'
      }
    }

    stage('Build & Validate Helm Chart') {
      steps {
        sh '''
          pnpm build
          helm lint "${HELM_CHART_PATH}"
          helm lint "${HELM_CHART_PATH}" -f "${HELM_CHART_PATH}/values-staging.yaml"
          helm lint "${HELM_CHART_PATH}" -f "${HELM_CHART_PATH}/values-prod.yaml"
          helm template "${HELM_RELEASE_NAME}" "${HELM_CHART_PATH}" \
            -f "${HELM_CHART_PATH}/values-prod.yaml" \
            --set "image.repository=${params.IMAGE_REPOSITORY}" \
            --set "image.tag=${IMAGE_TAG}" > /dev/null
        '''
      }
    }

    stage('Build & Push Container Image') {
      when {
        expression { return params.DEPLOY_TO_STAGING || params.DEPLOY_TO_PRODUCTION }
      }
      steps {
        withCredentials([usernamePassword(
          credentialsId: 'container-registry-credentials',
          usernameVariable: 'REGISTRY_USER',
          passwordVariable: 'REGISTRY_PASS'
        )]) {
          sh '''
            echo "${REGISTRY_PASS}" | docker login "$(echo "${IMAGE_REPOSITORY}" | cut -d/ -f1)" -u "${REGISTRY_USER}" --password-stdin
            docker build -f apps/server/Dockerfile -t "${IMAGE_REPOSITORY}:${IMAGE_TAG}" .
            docker push "${IMAGE_REPOSITORY}:${IMAGE_TAG}"
          '''
        }
      }
    }

    stage('Deploy Staging') {
      when {
        expression { return params.DEPLOY_TO_STAGING }
      }
      steps {
        withCredentials([file(credentialsId: 'kubeconfig-staging', variable: 'KUBECONFIG')]) {
          sh '''
            helm upgrade --install "${HELM_RELEASE_NAME}" "${HELM_CHART_PATH}" \
              --namespace "${STAGING_NAMESPACE}" \
              --create-namespace \
              -f "${HELM_CHART_PATH}/values-staging.yaml" \
              --set "image.repository=${IMAGE_REPOSITORY}" \
              --set "image.tag=${IMAGE_TAG}" \
              --atomic \
              --wait \
              --timeout 5m
          '''
        }
      }
    }

    stage('Manual Production Approval') {
      when {
        expression { return params.DEPLOY_TO_PRODUCTION }
      }
      steps {
        input message: "Deploy Coaching Catalyst (${env.IMAGE_TAG}) to production?", ok: 'Deploy'
      }
    }

    stage('Deploy Production') {
      when {
        expression { return params.DEPLOY_TO_PRODUCTION }
      }
      steps {
        withCredentials([file(credentialsId: 'kubeconfig-prod', variable: 'KUBECONFIG')]) {
          sh '''
            helm upgrade --install "${HELM_RELEASE_NAME}" "${HELM_CHART_PATH}" \
              --namespace "${PROD_NAMESPACE}" \
              --create-namespace \
              -f "${HELM_CHART_PATH}/values-prod.yaml" \
              --set "image.repository=${IMAGE_REPOSITORY}" \
              --set "image.tag=${IMAGE_TAG}" \
              --atomic \
              --wait \
              --timeout 5m
          '''
        }
      }
    }
  }

  post {
    always {
      archiveArtifacts artifacts: 'docs/architecture/domain-model.md,docs/architecture/lifecycles.md', fingerprint: true, allowEmptyArchive: true
      deleteDir()
    }
  }
}
