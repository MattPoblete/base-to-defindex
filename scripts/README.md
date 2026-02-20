# Scripts — Crossmint Smart Wallet PoC

Scripts independientes para interactuar con Crossmint Smart Wallets en Base y Stellar, fuera del entorno de la dapp Next.js.

El objetivo es validar que podemos crear wallets, firmar y enviar transacciones en cada blockchain usando las smart accounts de Crossmint.

## Scripts disponibles

| Script | Descripción |
|---|---|
| `src/base-wallet.ts` | Crea una wallet en Base, consulta balances, fondea (staging) y transfiere tokens |

## Requisitos

- Node.js >= 18
- Una API key server-side de [Crossmint Console](https://www.crossmint.com/console)

## Configuración

1. Instalar dependencias:

```bash
npm install
```

2. Crear el archivo `.env` a partir del ejemplo:

```bash
cp .env.example .env
```

3. Completar las variables en `.env`:

```env
# "staging" para testnet, "production" para mainnet
CROSSMINT_ENV=staging

# API key server-side desde la consola de Crossmint
CROSSMINT_SERVER_API_KEY=sk_staging_...

# Email asociado a la wallet
CROSSMINT_WALLET_EMAIL=tu-email@ejemplo.com
```

### Staging vs Production

| | Staging | Production |
|---|---|---|
| Chain | `base-sepolia` | `base` |
| Token | `usdxm` | `usdc` |
| Funding | Automático vía `stagingFund()` | Manual |
| Explorer | sepolia.basescan.org | basescan.org |

## Ejecución

```bash
npx tsx src/base-wallet.ts
```

El script realiza los siguientes pasos:

1. Crea o recupera la wallet asociada al email configurado
2. Consulta e imprime los balances actuales
3. Fondea la wallet con 10 USDXM (solo en staging)
4. Transfiere 1 token a una dirección de prueba
5. Imprime el hash de la transacción y el link al explorer

## Verificación

- **Staging:** verificar la transacción en https://sepolia.basescan.org con el tx hash impreso
- **Production:** verificar en https://basescan.org
