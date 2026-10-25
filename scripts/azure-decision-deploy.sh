#!/usr/bin/env bash
# F081.1 — create (or re-assert) the Microsoft-Decision-1 EU deployment. Idempotent:
# ARM PUT creates or leaves an identical resource as is, so running it twice is safe.
#
# Token: AZURE_ARM_TOKEN, else `az account get-access-token`. Login is cb@senti.info
# (tenant senti.info) — device-code via Lens + ARS, never a password typed by the owner.
set -euo pipefail
SUB="${AZURE_SUBSCRIPTION_ID:-aea479dd-ed66-40d0-bb6c-fca34e1673da}"
RG="${AZURE_RESOURCE_GROUP:-ai-sdk-generic-group}"
ACCOUNT="${AZURE_DECISION_ACCOUNT:-ai-sdk-decision-eu}"
DEPLOYMENT="${AZURE_DECISION_DEPLOYMENT:-decision-1-eu}"   # must NOT contain "microsoft" (ContainsReservedWord)
LOCATION=swedencentral
API=2024-10-01
TOKEN="${AZURE_ARM_TOKEN:-$(az account get-access-token --resource https://management.azure.com/ --query accessToken -o tsv)}"
R="https://management.azure.com/subscriptions/$SUB/resourceGroups/$RG/providers/Microsoft.CognitiveServices/accounts/$ACCOUNT"
H=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

curl -sf -X PUT "${H[@]}" "$R?api-version=$API" -d "{\"location\":\"$LOCATION\",\"kind\":\"AIServices\",\"sku\":{\"name\":\"S0\"},\"properties\":{\"customSubDomainName\":\"$ACCOUNT\",\"publicNetworkAccess\":\"Enabled\"},\"tags\":{\"owner\":\"ai-sdk\",\"feature\":\"F081\"}}" >/dev/null
until [ "$(curl -sf "${H[@]}" "$R?api-version=$API" | jq -r .properties.provisioningState)" = "Succeeded" ]; do sleep 5; done

# Data Zone Standard = EU data zone (EU + Norway + Switzerland). NoAutoUpgrade pins version 1.
curl -sf -X PUT "${H[@]}" "$R/deployments/$DEPLOYMENT?api-version=$API" \
  -d '{"sku":{"name":"DataZoneStandard","capacity":500},"properties":{"model":{"format":"Microsoft","name":"Microsoft-Decision-1","version":"1"},"versionUpgradeOption":"NoAutoUpgrade"}}' >/dev/null

curl -sf "${H[@]}" "$R/deployments/$DEPLOYMENT?api-version=$API" \
  | jq -c --arg loc "$LOCATION" '{deployment: .name, location: $loc, sku: .sku.name, capacity: .sku.capacity, model: .properties.model.name, version: .properties.model.version, upgrade: .properties.versionUpgradeOption, state: .properties.provisioningState}'
