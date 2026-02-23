#!/bin/bash
# Check USDC balance of our Crossmint Stellar smart account

USDC_CONTRACT="CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75"
ACCOUNT="CCZ3YKCWQ7EVEUD25SIQMVE6OHCEYJR42J5DUNAG6K7W2A5XYDK2KNRV"

stellar contract invoke \
  --rpc-url "https://mainnet.stellar.validationcloud.io/v1/KIkHfvSuHfYNtMujE1mMMM_XXKDTH5hCvfpbLIFy4r4" \
  --network-passphrase "Public Global Stellar Network ; September 2015" \
  --source "$ACCOUNT" \
  --id "$USDC_CONTRACT" \
  --send no \
  -- balance --id "$ACCOUNT"
