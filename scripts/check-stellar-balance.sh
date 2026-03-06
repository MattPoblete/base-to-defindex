#!/bin/bash
# Check USDC balance of our Crossmint Stellar smart account

USDC_CONTRACT="CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75"
ACCOUNT="CBIA4ZNTWINHEYLOAVWKZSA57ZQMRF7HNXSKEZXLYIKR667IZDWRPKGT"

stellar contract invoke \
  --rpc-url "https://rpc.lightsail.network/" \
  --network-passphrase "Public Global Stellar Network ; September 2015" \
  --source "$ACCOUNT" \
  --id "$USDC_CONTRACT" \
  --send no \
  -- balance --id "$ACCOUNT"
