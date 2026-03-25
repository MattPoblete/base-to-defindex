# Custodial vs Self-Custodial — Privy + Defindex (Stellar)

Comparación arquitectónica de los dos modelos de gestión de wallets para interactuar
con vaults de Defindex en Stellar usando Privy como proveedor de wallets.

---

## Definiciones

| Modelo | Descripción |
|---|---|
| **Custodial (server-managed)** | Tu servidor controla la wallet. El usuario no firma nada — confía en vos como operador. |
| **Self-custodial** | El usuario posee su wallet. Nadie más puede firmar en su nombre sin su aprobación explícita. |

---

## Arquitectura comparada

### Custodial

```
┌──────────────────────────────────────────────────────────┐
│  Tu Servidor                                             │
│                                                          │
│  P-256 private key ──► firma cada request a Privy API    │
│  P-256 public key  ──► registrada como owner de wallet   │
└──────────────────────┬───────────────────────────────────┘
                       │  HTTPS + privy-authorization-signature
                       ▼
┌──────────────────────────────────────────────────────────┐
│  Privy TEE                                               │
│                                                          │
│  Verifica firma P-256 → ejecuta rawSign                  │
│  Clave privada Stellar NUNCA sale del TEE                │
└──────────────────────────────────────────────────────────┘
```

- El usuario no interactúa en ningún paso.
- El servidor actúa como gestor de la wallet del usuario.
- Modelo típico de yield management automatizado, robo-advisors.

---

### Self-Custodial

```
┌──────────────────────────────────────────────────────────┐
│  Browser / App del Usuario                               │
│                                                          │
│  Login (email / Google / passkey)                        │
│  └─► Privy crea embedded wallet del usuario              │
│                                                          │
│  privy.sign(txHash) ──► modal de aprobación al usuario   │
└──────────────────────┬───────────────────────────────────┘
                       │  Solo el usuario puede aprobar
                       ▼
┌──────────────────────────────────────────────────────────┐
│  Privy TEE                                               │
│                                                          │
│  Verifica sesión del usuario → ejecuta rawSign           │
│  Clave privada Stellar NUNCA sale del TEE                │
└──────────────────────────────────────────────────────────┘
```

- El usuario aprueba cada transacción explícitamente.
- El servidor nunca puede firmar sin el usuario presente.
- Modelo típico de dapps, wallets de usuario final.

---

## Flujo de Deposit a Defindex — paso a paso

Los pasos **idénticos** en ambos modelos están marcados con `=`.

| Paso | Custodial | Self-Custodial |
|---|---|---|
| 1 | Servidor crea wallet con `idempotency_key` (P-256 owner) | Usuario hace login → Privy crea/recupera su embedded wallet |
| 2 | Servidor obtiene balance vía Horizon | Frontend obtiene balance vía Horizon |
| 3 `=` | `POST api.defindex.io/vault/{addr}/deposit` → `{ xdr }` | `POST api.defindex.io/vault/{addr}/deposit` → `{ xdr }` |
| 4 `=` | `TransactionBuilder.fromXDR(xdr)` → `transaction.hash()` | `TransactionBuilder.fromXDR(xdr)` → `transaction.hash()` |
| **5** ⚠️ | `privy.wallets().rawSign(walletId, { hash }, authContext)` | `wallet.sign({ message: txHashBytes })` → modal usuario |
| 6 `=` | Attach `xdr.DecoratedSignature` al envelope | Attach `xdr.DecoratedSignature` al envelope |
| 7 `=` | `POST api.defindex.io/send` → `{ txHash }` | `POST api.defindex.io/send` → `{ txHash }` |

**Solo el paso 5 difiere.** El resto del flujo es reutilizable en ambos modelos.

---

## Diferencias de implementación

### SDK utilizado

```
Custodial     →  @privy-io/node       (Node.js, server-side)
Self-Custodial →  @privy-io/react-auth (React) | @privy-io/expo (React Native)
```

### Autenticación en Privy

```typescript
// CUSTODIAL — Authorization Key (servidor)
// config en Privy Dashboard: Wallets → Authorization Keys → New Key
const authorization_context = {
  authorization_private_keys: [authorizationPrivateKey],
};
await privy.wallets().rawSign(walletId, {
  params: { hash: txHashHex },
  authorization_context,
});

// SELF-CUSTODIAL — sesión del usuario (browser)
// No hay authorization_context — Privy verifica la sesión activa del usuario
const { signature } = await wallet.sign({ message: txHashBytes });
// Privy muestra un modal → el usuario aprueba o rechaza
```

### Obtención del walletId

```typescript
// CUSTODIAL — el servidor crea la wallet y guarda el ID
const wallet = await privy.wallets().create({
  chain_type: "stellar",
  owner: { public_key: authorizationPublicKey },
  idempotency_key: "user-123-stellar-v1",
});
const walletId = wallet.id;

// SELF-CUSTODIAL — viene de la sesión autenticada del usuario
const { wallets } = usePrivy();
const stellarWallet = wallets.find(w => w.chainType === "stellar");
const walletAddress = stellarWallet.address;
```

### Separación de responsabilidades recomendada (self-custodial)

```
Backend  (tu servidor)
  └─► POST api.defindex.io/vault/{addr}/deposit → devuelve xdr al frontend
      (evita exponer la Defindex API key al browser)

Frontend (browser del usuario)
  └─► parsea xdr → solicita firma a Privy → usuario aprueba
  └─► adjunta DecoratedSignature
  └─► POST api.defindex.io/send → txHash
```

---

## Comparación de propiedades

| Propiedad | Custodial | Self-Custodial |
|---|---|---|
| **Control de la clave privada** | Servidor (vía TEE) | Usuario (vía TEE) |
| **Interacción del usuario** | Ninguna | Aprobación por tx |
| **Puede automatizarse** | ✅ Sí (cron, triggers, etc.) | ❌ No (requiere usuario activo) |
| **Responsabilidad legal** | Vos (como custodio) | El usuario |
| **UX** | Transparente / invisible | Modal de firma |
| **Recovery si pierdo acceso** | Vos gestionás la recuperación | El usuario gestiona su recovery |
| **Riesgo de fondos** | Si tu servidor es comprometido | Solo si el usuario es comprometido |
| **Regulación (Argentina/LATAM)** | Mayor escrutinio (VASP) | Menor (non-custodial) |
| **Tiempo de integración** | Menor (solo backend) | Mayor (frontend + UX) |

---

## Cuándo usar cada modelo

### Usar Custodial cuando:
- Sos un gestor de inversiones o fondo (yield management automatizado).
- El usuario quiere "depositar y olvidarse" — no debe aprobar cada rebalanceo.
- Necesitás ejecutar operaciones programadas (ej: rebalanceo diario).
- El usuario no tiene conocimiento técnico de wallets.

### Usar Self-Custodial cuando:
- Querés minimizar responsabilidad legal sobre los fondos del usuario.
- El usuario debe aprobar explícitamente cada movimiento.
- Construís una dapp pública donde cualquiera puede conectar su wallet.
- El modelo de negocio requiere transparencia total ("not your keys, not your coins").

### Modelo híbrido (avanzado):
El usuario posee su wallet (self-custodial) pero delega permisos específicos al servidor
mediante **Soroban contract-level authorization** — el servidor puede ejecutar solo las
operaciones autorizadas por el usuario dentro del contrato, sin acceso irrestricto a sus fondos.

---

## Archivos relevantes en este repositorio

| Archivo | Modelo | Descripción |
|---|---|---|
| `scripts/src/wallets/privy-defindex-wallet.ts` | Custodial | `depositToDefindexVault()` server-side |
| `scripts/src/privy/privy-defindex-poc.ts` | Custodial | Entry point POC 3 |
| `scripts/src/wallets/privy-stellar-wallet.ts` | Custodial | `rawSign` + Horizon broadcast |
| `scripts/src/shared/privy-client.ts` | Custodial | PrivyClient + `buildAuthContext()` |
| `dapp/` | Self-Custodial *(pendiente)* | Frontend Next.js para integración con usuario |
