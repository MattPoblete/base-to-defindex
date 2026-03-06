# Bridge & Wallet Scripts

Este directorio contiene herramientas CLI para gestionar wallets e interactuar con protocolos de bridge (**Sodax** y **Allbridge**) de forma programática.

## 🚀 Scripts de Bridge (Sodax)

Recomendamos usar **Sodax** para mover fondos de Base a Stellar debido a su integración con solvers que optimizan la velocidad y el costo.

| Comando | Descripción |
|---|---|
| `npm run sodax-bridge -- <ADDR>` | Realiza un **Swap + Bridge** usando un solver. (Recomendado) |
| `npm run sodax-bridge-pure -- <ADDR>` | Realiza un **Bridge 1:1** directo sin intercambio. |
| `npm run sodax-status -- <HASH>` | Monitorea el estado de una transacción y decodifica el payload. |

### Ejemplo de uso
```bash
# Ejecutar un bridge hacia una dirección de Stellar
npm run sodax-bridge -- GDNNTSIFUR7DE7D3AZCA6IICGEXBRVZ6UXGEURPEAH3VWOBF2RQE3U44

# Consultar el estado de una transacción enviada
npm run sodax-status -- 0x33f2af36bc382145e803c95102b6973505a908590e7239b7d0022d80f5ff7792
```

---

## 👛 Gestión de Wallets

Scripts para validar la creación y operación de Smart Wallets vía **Crossmint**.

| Comando | Descripción |
|---|---|
| `npm run base-wallet` | Gestiona Smart Wallets en **Base** (EVM). |
| `npm run stellar-wallet` | Gestiona Smart Wallets en **Stellar** (Soroban). |

---

## 🛠️ Configuración

1. **Instalar dependencias:**
   ```bash
   npm install
   ```

2. **Configurar variables de entorno:**
   Copia el archivo `.env.example` a `.env` y completa las variables necesarias:
   ```env
   EVM_PRIVATE_KEY=...
   BASE_RPC_URL=https://mainnet.base.org
   CROSSMINT_SERVER_API_KEY=...
   CROSSMINT_WALLET_EMAIL=...
   ```

## 🏗️ Otros Scripts (Legacy/PoC)

- `npm run allbridge-bridge`: Pruebas iniciales con Allbridge Core SDK.
- `npm run crossmint-bridge`: Pruebas de bridge usando firmas delegadas de Crossmint.
- `npm run near-intents`: Integración experimental con Defuse/Near Intents.

---

## 🔍 Verificación

- **Base Explorer:** [Basescan](https://basescan.org)
- **Stellar Explorer:** [Stellar.expert](https://stellar.expert)
- **Sodax Status:** Puedes usar el script `sodax-status` para obtener detalles técnicos decodificados de cualquier intent.
