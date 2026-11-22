{{- define "coaching-catalyst.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "coaching-catalyst.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "coaching-catalyst.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "coaching-catalyst.version" -}}
{{- .Values.image.tag | default .Chart.AppVersion -}}
{{- end -}}

{{- define "coaching-catalyst.labels" -}}
helm.sh/chart: {{ include "coaching-catalyst.chart" . }}
{{ include "coaching-catalyst.selectorLabels" . }}
app.kubernetes.io/version: {{ include "coaching-catalyst.version" . | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- if .Values.datadog.enabled }}
tags.datadoghq.com/env: {{ .Values.datadog.env | default .Values.config.telemetry.environment | quote }}
tags.datadoghq.com/service: {{ .Values.datadog.service | default .Values.config.telemetry.serviceName | quote }}
tags.datadoghq.com/version: {{ .Values.datadog.version | default (include "coaching-catalyst.version" .) | quote }}
{{- end }}
{{- end -}}

{{- define "coaching-catalyst.selectorLabels" -}}
app.kubernetes.io/name: {{ include "coaching-catalyst.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "coaching-catalyst.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "coaching-catalyst.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "coaching-catalyst.secretName" -}}
{{- if .Values.secrets.externalSecret.enabled -}}
{{- printf "%s-vault" (include "coaching-catalyst.fullname" .) -}}
{{- else -}}
{{- .Values.secrets.existingSecret -}}
{{- end -}}
{{- end -}}
