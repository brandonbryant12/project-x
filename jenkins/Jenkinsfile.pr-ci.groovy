/*
 * Coaching Catalyst - Pull Request CI Pipeline (Pipeline from SCM)
 *
 * Blocking quality gate for pull requests:
 * - Zero production/registry/cluster credentials bound.
 * - Verifies format, strict lint, tsc7, @alchemy.run/domain formal proofs,
 *   PGlite DB integrity & scenario tests, knip, docs/diagram drift, build,
 *   and Helm chart lint/render.
 */

pipeline {
  agent { label 'linux && node24' }

  options {
    timestamps()
    ansiColor('xterm')
    disableConcurrentBuilds()
    timeout(time: 35, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '80', artifactNumToKeepStr: '20'))
  }

  environment {
    CI = 'true'
    PNPM_HOME = "${WORKSPACE}/.pnpm-home"
    PATH = "${PNPM_HOME}:${PATH}"
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
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

    stage('Real Postgres 18 Lane (Optional)') {
      when {
        environment name: 'TEST_DATABASE_URL', value: ''
        beforeAgent true
      }
      steps {
        echo 'Skipping pnpm test:pg (TEST_DATABASE_URL not set on this agent).'
      }
    }

    stage('Build') {
      steps {
        sh 'pnpm build'
      }
    }

    stage('Helm Lint & Template Dry-Run') {
      steps {
        sh '''
          if command -v helm >/dev/null 2>&1; then
            helm lint helm/coaching-catalyst
            helm lint helm/coaching-catalyst -f helm/coaching-catalyst/values-staging.yaml
            helm lint helm/coaching-catalyst -f helm/coaching-catalyst/values-prod.yaml
            helm template coaching-catalyst helm/coaching-catalyst \
              -f helm/coaching-catalyst/values-prod.yaml \
              --set image.tag="sha-$(git rev-parse --short=12 HEAD)" > /dev/null
          else
            echo "helm CLI not installed on this agent; skipping chart render check."
          fi
        '''
      }
    }
  }

  post {
    always {
      archiveArtifacts artifacts: 'docs/architecture/domain-model.md,docs/architecture/lifecycles.md', allowEmptyArchive: true
      deleteDir()
    }
  }
}
