# PROYECTO: Bridge Base→Stellar + Integración DeFindex

## PROGRESO POR FASE

### Fase 1: Setup y Configuración Base ✅
- [x] Crear proyecto Next.js (App Router, TypeScript, Tailwind)
- [x] Instalar dependencias (@allbridge/bridge-core-sdk, @crossmint/client-sdk-react-ui, @crossmint/wallets-sdk, @tanstack/react-query)
- [x] Crear configuración Allbridge (`src/services/allbridge/config.ts`)
- [x] Configurar variables de entorno (`.env` con testnet URLs + Crossmint staging key)

### Fase 2: Wallet Integration con Crossmint ✅
- [x] Setup Crossmint providers (`src/app/providers.tsx`)
- [x] Workaround SSR para crypto SDKs (`src/app/client-providers.tsx` con dynamic import ssr:false)
- [x] Hook multi-chain wallets (`src/hooks/useCrossmintWallets.ts`) — Stellar via createOnLogin + Base via CrossmintWallets SDK
- [x] Componente WalletConnector con login/logout, addresses, copy button, balances
- [x] Formato de balances (4 decimales para < 1)

### Fase 3: Allbridge SDK Integration ✅
- [x] Servicio bridge (`src/services/allbridge/bridge.service.ts`) — getTokens, findToken, getQuote, buildSendParams, buildRawTransaction
- [x] Types (`src/services/allbridge/types.ts`)
- [x] Hook useAllbridgeSDK (`src/hooks/useAllbridgeSDK.ts`)
- [x] Hook useBridgeFeeCalculator (`src/hooks/useBridgeFeeCalculator.ts`) con debounce 500ms
- [x] Fix: destino usa `ChainSymbol.SRB` (Soroban) en vez de `STLR`
- [x] Fix: solo USDC disponible en ruta Base↔Stellar (USDT no soportado por Allbridge)

### Fase 4: UI Components Core ✅
- [x] ChainSelector (Base → Stellar display)
- [x] TokenSelector (solo USDC)
- [x] AmountInput con botón MAX, validación de balance
- [x] BridgePreview (fee breakdown, loading states, errors)
- [x] BridgeWidget (integra todos los componentes + botón Bridge)
- [x] Página `/bridge` con WalletConnector + BridgeWidget

### Fase 5: Bridge Transaction Flow ⬅️ SIGUIENTE
- [ ] Hook `useBridgeTransaction.ts` — build tx con Allbridge SDK + firmar con Crossmint Base wallet
- [ ] Verificación de trustline USDC en Stellar antes del bridge
- [ ] Integrar botón Bridge con ejecución real de transacción
- [ ] Loading state durante transaction
- [ ] Manejo de errores (insufficient balance, user rejected, network error)

### Fase 6: Bridge Status Tracking
- [ ] Hook `useBridgeStatus.ts` — polling status via Allbridge API
- [ ] Componente BridgeProgress (progress bar, links a explorers, tiempo restante)
- [ ] Detección automática de bridge completado

### Fase 7: Integración DeFindex Deposit
- [ ] Servicio `bridge-to-vault/flow.service.ts` — orquesta bridge → deposit
- [ ] Componente DepositPrompt (aparece al completar bridge)
- [ ] Deposit en vault via `StellarWallet.from(wallet).sendTransaction()` (patrón crossmint-poc)
- [ ] Flujo completo end-to-end: Base USDC → Stellar USDC → DeFindex vault

### Fase 8: Error Handling & Edge Cases
- [ ] Manejo robusto de errores en cada paso
- [ ] Trustline automática via StellarWallet
- [ ] Bridge timeout handling (>30 min)
- [ ] Retry logic para transacciones fallidas
- [ ] Componente ErrorDisplay

### Fase 9: Polish & Optimizations
- [ ] Responsive design (mobile + desktop)
- [ ] Loading states completos (skeletons, spinners)
- [ ] Animaciones de éxito/error
- [ ] Performance (lazy load, optimistic UI)

### Fase 10: Testing & Documentation
- [ ] Unit tests (bridge.service, hooks)
- [ ] Integration tests en testnet
- [ ] Documentación (`docs/BRIDGE_INTEGRATION.md`)

---

## CONTEXTO DEL PROYECTO

Estoy trabajando en DeFindex, un protocolo de yield aggregation en Stellar/Soroban.
Necesito implementar el issue #799: permitir que usuarios hagan bridge desde Base
(Ethereum L2) hacia Stellar y luego depositen en vaults de DeFindex.

**Stack actual de DeFindex:**

- Frontend: Next.js 14+ (App Router), TypeScript, TailwindCSS
- Blockchain: Stellar/Soroban smart contracts
- Wallets: Crossmint (Base EVM + Stellar), smart wallets con account abstraction
- SDK: @stellar/stellar-sdk, stellar-sdk soroban

**Repositorio:** https://github.com/paltalabs/defindex

## OBJETIVO

Crear una nueva feature que permita a usuarios:

1. Autenticarse con Crossmint (email, Google, Farcaster) → se crean wallets de Base + Stellar
2. Seleccionar cantidad de USDC/USDT en Base
3. Ver preview de bridge (fees, tiempo, amount final)
4. Ejecutar bridge usando Allbridge Core SDK
5. Detectar cuando el bridge se completa
6. Mostrar opción para depositar en vault de DeFindex
7. Ejecutar deposit usando código existente de DeFindex

## REQUISITOS TÉCNICOS

**Dependencias nuevas:**

- @allbridge/bridge-core-sdk (para bridge Base↔Stellar)
- @crossmint/client-sdk-react-ui (auth + wallet Stellar via createOnLogin)
- @crossmint/wallets-sdk (crear wallet Base programáticamente vía getOrCreateWallet)

**Integraciones:**

- Crossmint: https://docs.crossmint.com (wallets + auth)
- Allbridge Core: https://docs-core.allbridge.io
- Base RPC: https://base-rpc.publicnode.com
- Stellar Soroban RPC: https://rpc.ankr.com/stellar_soroban

**Arquitectura Crossmint (Base + Stellar):**

- **Stellar:** Client-side via `CrossmintWalletProvider` con `createOnLogin: { chain: "stellar" }`.
  Se crea automáticamente al login. Usar `StellarWallet.from(wallet).sendTransaction()` para
  llamar contratos Soroban (patrón probado en `paltalabs/crossmint-poc`).
- **Base (EVM):** Client-side via `@crossmint/wallets-sdk`. Como `CrossmintWalletProvider`
  solo soporta una chain en `createOnLogin`, la wallet de Base se crea programáticamente
  con `CrossmintWallets.from(crossmint).getOrCreateWallet({ chain: "base-sepolia" })`.
- **Auth unificada:** Un solo login de Crossmint genera wallets en ambas chains bajo
  la misma identidad (ej: `email:user@example.com`). Todo es 100% client-side.
- **Referencia:** POC funcional en `paltalabs/crossmint-poc` (Stellar + DeFindex deposit).
- **Referencia producción:** MoneyGram, Wirex y Marshall Islands usan Crossmint + Stellar.

## ESTRUCTURA DEL PROYECTO

```md
src/
├── app/
│   └── bridge/
│       └── page.tsx              # Nueva página de bridge
├── components/
│   └── bridge/
│       ├── BridgeWidget.tsx      # Widget principal
│       ├── ChainSelector.tsx     # Selector Base/otras chains
│       ├── TokenSelector.tsx     # USDC/USDT selector
│       ├── AmountInput.tsx       # Input con balance
│       ├── BridgePreview.tsx     # Muestra fees, tiempo, output
│       ├── BridgeProgress.tsx    # Status bar durante bridge
│       └── DepositPrompt.tsx     # CTA para depositar en vault
├── hooks/
│   ├── useAllbridgeSDK.ts       # Hook para SDK de Allbridge
│   ├── useBridgeTransaction.ts  # Maneja todo el flujo de bridge
│   ├── useBridgeStatus.ts       # Polling de status de bridge
│   ├── useCrossmintWallets.ts   # Maneja wallets Base + Stellar via Crossmint
│   └── useTrustlineCheck.ts     # Verifica/crea trustlines Stellar
├── services/
│   ├── allbridge/
│   │   ├── config.ts            # Configuración de chains/tokens
│   │   ├── bridge.service.ts   # Lógica de bridge
│   │   └── types.ts            # Types de Allbridge
│   ├── crossmint/
│   │   └── config.ts            # Configuración Crossmint (providers, chains, constants)
│   └── bridge-to-vault/
│       └── flow.service.ts     # Orquesta bridge → deposit
├── lib/
│   └── constants/
│       └── bridge.ts            # Constantes (chains, tokens, fees)
└── types/
    └── bridge.types.ts          # TypeScript interfaces
```

## CRITERIOS DE ACEPTACIÓN (Medibles)

### ✅ MVP Funcional

- [ ] Usuario puede autenticarse via Crossmint (email, Google, social)
- [ ] Se crea automáticamente smart wallet de Stellar via Crossmint (createOnLogin)
- [ ] Se crea smart wallet de Base via CrossmintWallets SDK (getOrCreateWallet)
- [ ] Se muestra balance de USDC en Base
- [ ] Usuario puede ingresar cantidad válida (≤ balance)
- [ ] Se calcula y muestra: bridge fee, gas, amount final
- [ ] Usuario puede confirmar bridge
- [ ] Transacción de bridge se ejecuta en Base
- [ ] Se muestra status de bridge en tiempo real
- [ ] Al completar bridge, se detecta USDC en Stellar
- [ ] Se muestra botón para depositar en vault
- [ ] Flujo completo end-to-end funciona

### 🎨 UX Completa

- [ ] Loading states en todos los pasos
- [ ] Error handling (insufficient balance, failed tx, etc.)
- [ ] Success/failure notifications
- [ ] Links a block explorers (Base + Stellar)
- [ ] Estimación de tiempo de bridge
- [ ] Responsive design (mobile + desktop)

### 🔒 Seguridad

- [ ] Validación de amounts (no negative, no zero)
- [ ] Verificación de trustlines antes de bridge
- [ ] Slippage protection
- [ ] Timeout handling para bridges stuck

## PLAN DE IMPLEMENTACIÓN

Implementa en este orden, completando cada fase antes de seguir:

### FASE 1: Setup y Configuración Base (Día 1)

**Output medible:** Branch con dependencias instaladas, configs listas, sin errores

1.1 Instalar dependencias

```bash
npm install @allbridge/bridge-core-sdk @crossmint/client-sdk-react-ui @crossmint/wallets-sdk @tanstack/react-query
```

1.2 Crear archivo de configuración `src/services/allbridge/config.ts`:

```typescript
import { ChainSymbol, NodeRpcUrls } from '@allbridge/bridge-core-sdk';

export const ALLBRIDGE_CONFIG: NodeRpcUrls = {
  [ChainSymbol.BAS]: process.env.NEXT_PUBLIC_BASE_RPC_URL!,
  [ChainSymbol.SRB]: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL!,
  [ChainSymbol.STLR]: process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL!,
};

export const SUPPORTED_TOKENS = ['USDC'] as const;
```

1.3 Agregar a `.env.local`:

```md
NEXT_PUBLIC_BASE_RPC_URL=https://base-rpc.publicnode.com
NEXT_PUBLIC_SOROBAN_RPC_URL=https://rpc.ankr.com/stellar_soroban
NEXT_PUBLIC_STELLAR_HORIZON_URL=https://horizon.stellar.org

# Crossmint (obtener de https://staging.crossmint.com/console/projects/apiKeys)
# Solo necesita client-side API key (todo es client-side)
NEXT_PUBLIC_CROSSMINT_API_KEY=your_client_api_key_here
```

**Test:** `npm run dev` corre sin errores, todas las env vars se cargan

---

### FASE 2: Wallet Integration con Crossmint (Día 1-2)

**Output medible:** Usuario puede autenticarse con Crossmint y obtener wallets en Base + Stellar

**Referencia:** Patrón base tomado de `paltalabs/crossmint-poc` (Stellar funcional).

2.1 Setup Crossmint Providers en `src/app/providers.tsx`:

```typescript
"use client";

import {
  CrossmintProvider,
  CrossmintAuthProvider,
  CrossmintWalletProvider,
} from "@crossmint/client-sdk-react-ui";

export function CrossmintProviders({ children }: { children: React.ReactNode }) {
  return (
    <CrossmintProvider apiKey={process.env.NEXT_PUBLIC_CROSSMINT_API_KEY!}>
      <CrossmintAuthProvider
        loginMethods={["email", "google", "farcaster"]}
      >
        {/* createOnLogin crea Stellar wallet automáticamente al login */}
        {/* (mismo patrón que crossmint-poc) */}
        <CrossmintWalletProvider
          createOnLogin={{
            chain: "stellar",
            signer: { type: "email" },
          }}
        >
          {children}
        </CrossmintWalletProvider>
      </CrossmintAuthProvider>
    </CrossmintProvider>
  );
}
```

2.2 Crear hook `src/hooks/useCrossmintWallets.ts`:

```typescript
import { useState, useEffect } from "react";
import { useAuth, useWallet, useCrossmint } from "@crossmint/client-sdk-react-ui";
import { CrossmintWallets, StellarWallet } from "@crossmint/wallets-sdk";

export function useCrossmintWallets() {
  const { login, logout, user, status: authStatus } = useAuth();
  const { crossmint } = useCrossmint();
  // Stellar wallet: viene del createOnLogin automático
  const { wallet: stellarWallet, status: stellarStatus } = useWallet();

  // Base wallet: se crea programáticamente con CrossmintWallets SDK
  const [baseWallet, setBaseWallet] = useState(undefined);
  const [baseStatus, setBaseStatus] = useState<'not-loaded' | 'loading' | 'loaded' | 'error'>('not-loaded');

  useEffect(() => {
    async function createBaseWallet() {
      if (!crossmint || !user || stellarStatus !== 'loaded') return;
      try {
        setBaseStatus('loading');
        const wallets = CrossmintWallets.from(crossmint);
        const wallet = await wallets.getOrCreateWallet({
          chain: "base-sepolia", // "base" en mainnet
          signer: { type: "email", email: user.email },
        });
        setBaseWallet(wallet);
        setBaseStatus('loaded');
      } catch (error) {
        console.error("Failed to create Base wallet:", error);
        setBaseStatus('error');
      }
    }
    createBaseWallet();
  }, [crossmint, user, stellarStatus]);

  const allReady = stellarStatus === 'loaded' && baseStatus === 'loaded';

  return {
    // Auth
    login, logout, user, isAuthenticated: !!user, authStatus,
    // Stellar wallet (auto-created via createOnLogin)
    stellarWallet,  // usar StellarWallet.from(stellarWallet) para sendTransaction
    stellarAddress: stellarWallet?.address,
    stellarReady: stellarStatus === 'loaded',
    // Base wallet (created via CrossmintWallets SDK)
    baseWallet,
    baseAddress: baseWallet?.address,
    baseReady: baseStatus === 'loaded',
    // Overall
    allWalletsReady: allReady,
  };
}
```

2.3 Crear componente `src/components/bridge/WalletConnector.tsx`

- Botón "Login" que llama `login()` de Crossmint
- Al autenticarse, Stellar wallet se crea automáticamente (createOnLogin)
- Base wallet se crea programáticamente después del login
- Muestra address de Base y Stellar cuando listas
- Muestra balance de USDC en Base
- Botón logout

2.4 Para interactuar con contratos Soroban (DeFindex deposit), usar patrón del POC:

```typescript
import { StellarWallet } from "@crossmint/client-sdk-react-ui";

// Deposit en vault de DeFindex (mismo patrón que crossmint-poc)
const stellarW = StellarWallet.from(stellarWallet);
const tx = await stellarW.sendTransaction({
  contractId: DEFINDEX_CONTRACT,
  method: 'deposit',
  args: {
    amounts_desired: [50000000],
    amounts_min: [50000000],
    from: stellarWallet.address,
    invest: true,
  },
});
```

**Test:**

- Click "Login" abre modal de Crossmint (email/Google/Farcaster)
- Autenticarse crea wallet de Stellar automáticamente (createOnLogin)
- Wallet de Base se crea programáticamente (CrossmintWallets SDK)
- Ambas addresses visibles en UI
- Balance de USDC se muestra correctamente
- Todo es 100% client-side (sin API routes server-side)

---

### FASE 3: Allbridge SDK Integration (Día 2)

**Output medible:** Hook que puede obtener info de tokens y calcular fees

3.1 Crear service `src/services/allbridge/bridge.service.ts`:

```typescript
export class AllbridgeService {
  private sdk: AllbridgeCoreSdk;
  
  async getChainDetails() { ... }
  async calculateBridgeFee(params) { ... }
  async buildBridgeTransaction(params) { ... }
}
```

3.2 Crear hook `src/hooks/useAllbridgeSDK.ts`

3.3 Crear hook `src/hooks/useBridgeFeeCalculator.ts`:

```typescript
export function useBridgeFeeCalculator(
  amount: string,
  sourceChain: 'BAS',
  targetChain: 'SRB',
  token: 'USDC' | 'USDT'
) {
  // Retorna: fee, estimatedTime, amountAfterFee, gasEstimate
}
```

**Test:**

- Console log de fee calculation funciona
- Fees son > 0 y < amount
- estimatedTime está en rango razonable (2-10 min)

---

### FASE 4: UI Components Core (Día 3)

**Output medible:** UI completa (sin funcionalidad) donde usuario puede ver todo el flujo

4.1 `src/components/bridge/ChainSelector.tsx`

- Radio buttons o dropdown: Base → Stellar (fixed por ahora)

4.2 `src/components/bridge/TokenSelector.tsx`

- Select entre USDC / USDT

4.3 `src/components/bridge/AmountInput.tsx`

```typescript
<AmountInput
  balance={balance}
  value={amount}
  onChange={setAmount}
  token="USDC"
/>
// Incluye botón "Max"
// Muestra balance disponible
// Validación: amount <= balance
```

4.4 `src/components/bridge/BridgePreview.tsx`

```typescript
<BridgePreview
  amount="100"
  fee="0.5"
  gasEstimate="0.0001"
  amountAfterFee="99.5"
  estimatedTime="3 min"
/>
```

4.5 `src/components/bridge/BridgeWidget.tsx`

- Integra todos los componentes anteriores
- Layout bonito con TailwindCSS

**Test:**

- Página `/bridge` muestra todos los componentes
- Input de amount valida correctamente
- Max button pone el balance completo
- Preview actualiza cuando cambias amount

---

### FASE 5: Bridge Transaction Flow (Día 3-4)

**Output medible:** Usuario puede ejecutar bridge real de Base a Stellar

5.1 Crear hook `src/hooks/useBridgeTransaction.ts`:

```typescript
export function useBridgeTransaction() {
  const executeBridge = async (params) => {
    // 1. Verificar trustline en Stellar (via Crossmint Stellar wallet)
    // 2. Build transaction en Base via Allbridge SDK
    // 3. Firmar con Crossmint smart wallet (baseWallet.send() o viem client)
    // 4. Enviar transaction
    // 5. Retornar txHash
  };
  
  return {
    executeBridge,
    isLoading,
    error,
    txHash,
  };
}
```

5.2 Integrar en BridgeWidget:

- Botón "Bridge" llama executeBridge
- Deshabilitar botón si: no wallet, amount inválido, balance insuficiente
- Loading state durante transaction

5.3 Manejo de errores:

- Crossmint wallet not ready / auth expired
- Insufficient balance
- Network error

**Test:**

- Ejecutar bridge en testnet (Base Sepolia → Stellar Testnet)
- Transaction aparece en Base explorer
- No errores en console

---

### FASE 6: Bridge Status Tracking (Día 4)

**Output medible:** UI muestra status en tiempo real del bridge hasta completarse

6.1 Crear hook `src/hooks/useBridgeStatus.ts`:

```typescript
export function useBridgeStatus(txHash: string) {
  // Polling cada 10s al API de Allbridge
  // Estados: pending, processing, completed, failed
  
  return {
    status: 'processing',
    progress: 60, // percentage
    estimatedTimeRemaining: '2 min',
  };
}
```

6.2 Crear componente `src/components/bridge/BridgeProgress.tsx`:

```typescript
<BridgeProgress
  status="processing"
  progress={60}
  txHash="0x..."
  sourceChain="Base"
  targetChain="Stellar"
/>
// Progress bar animado
// Links a explorers
// Estimated time remaining
```

**Test:**

- Ejecutar bridge
- Progress bar se actualiza automáticamente
- Cuando completa, muestra "Completed"
- Links a explorers funcionan

---

### FASE 7: Integration con DeFindex Deposit (Día 5)

**Output medible:** Flujo completo Base→Stellar→Vault funciona end-to-end

7.1 Crear `src/services/bridge-to-vault/flow.service.ts`:

```typescript
export async function bridgeAndDeposit(params: {
  amount: string;
  baseWalletAddress: string;
  stellarWalletAddress: string;
  vaultAddress: string;
}) {
  // 1. Execute bridge
  const bridgeTx = await executeBridge(...);
  
  // 2. Wait for bridge completion
  await waitForBridgeCompletion(bridgeTx.hash);
  
  // 3. Trigger deposit flow
  const depositTx = await depositToVault(...);
  
  return { bridgeTx, depositTx };
}
```

7.2 Crear componente `src/components/bridge/DepositPrompt.tsx`:

```typescript
<DepositPrompt
  amount="99.5"
  onDeposit={() => router.push('/vaults')}
  onSkip={() => router.push('/portfolio')}
/>
// Aparece cuando bridge completa
// Muestra vaults disponibles
// Botón "Deposit Now" o "Skip"
```

7.3 Integrar en BridgeWidget:

- Cuando status === 'completed'
- Mostrar DepositPrompt
- Si user click "Deposit Now", redirigir a vault selection
- Pre-fill amount en deposit form

**Test:**

- Bridge completo en testnet
- DepositPrompt aparece automáticamente
- Click "Deposit" lleva a página correcta con amount pre-filled
- Deposit en vault se ejecuta correctamente

---

### FASE 8: Error Handling & Edge Cases (Día 5-6)

**Output medible:** Todos los edge cases manejan gracefully con UX clara

8.1 Implementar manejo de errores:

- Insufficient balance
- User rejected transaction
- Bridge timeout (>30 min)
- Network errors
- Failed bridge (Allbridge error)

8.2 Crear `src/components/bridge/ErrorDisplay.tsx`:

```typescript
<ErrorDisplay
  error={error}
  onRetry={() => retryBridge()}
  onSupport={() => openSupportModal()}
/>
```

8.3 Trustline handling automático:

- Detectar si Stellar wallet (Crossmint) NO tiene trustline para USDC
- Crear trustline automáticamente via StellarWallet.sendTransaction()
- Mostrar progress de trustline creation
- La smart wallet de Crossmint en Stellar maneja gas/fees internamente

**Test:**

- Intentar bridge sin balance → Error claro
- Crossmint auth expired → Re-login automático o prompt claro
- Bridge timeout → Opción de retry o check status
- User sin trustline → Trustline se crea automáticamente via StellarWallet

---

### FASE 9: Polish & Optimizations (Día 6-7)

**Output medible:** UX pulida, mobile responsive, performance optimizada

9.1 Responsive design:

- Test en mobile (320px width)
- Test en tablet
- Test en desktop

9.2 Loading states:

- Skeleton loaders mientras carga data
- Botones con spinners durante transactions
- Progress bar smooth animations

9.3 Micro-interactions:

- Success animations (confetti o checkmark)
- Error shake animations
- Smooth transitions entre estados

9.4 Performance:

- Lazy load componentes pesados
- Debounce en amount input
- Optimistic UI updates donde sea posible

**Test:**

- Lighthouse score > 90
- No layout shifts (CLS)
- Funciona bien en mobile Chrome
- Todas las animaciones son smooth (60fps)

---

### FASE 10: Testing & Documentation (Día 7)

**Output medible:** Tests pasan, README actualizado, video demo grabado

10.1 Unit tests:

- `useBridgeTransaction.test.ts`
- `bridge.service.test.ts`
- `useBridgeFeeCalculator.test.ts`

10.2 Integration tests:

- Flujo completo en testnet
- Test con diferentes amounts
- Test error scenarios

10.3 Crear `docs/BRIDGE_INTEGRATION.md`:

# Bridge Base → Stellar Integration

## Overview

[Explicación de cómo funciona]

## User Flow

[Screenshots del flujo]

## Technical Details

[Arquitectura, decisiones técnicas]

## Troubleshooting

[Errores comunes y soluciones]

10.4 Grabar video demo (2-3 min)

- Mostrar flujo completo
- Explicar features principales

**Test:**

- `npm test` pasa sin errores
- README tiene instrucciones claras
- Video demo uploaded al repo

---

## NOTAS IMPORTANTES

1. **Prioridad a UX:** Cada paso debe tener loading/error states claros
2. **Mobile-first:** Diseña pensando en mobile primero
3. **Testnet first:** Todo en testnet antes de mainnet
4. **Incremental commits:** Commit después de cada sub-tarea completada
5. **Type-safe:** Todos los tipos en TypeScript, no `any`

## DEFINICIÓN DE DONE POR FASE

Cada fase está completa cuando:
- ✅ Código compila sin errores
- ✅ Tests relevantes pasan
- ✅ UI se ve bien en mobile y desktop
- ✅ No hay console errors o warnings
- ✅ Git commit con mensaje descriptivo
- ✅ Demo funcional grabado (al menos screenshot)

## COMANDOS ÚTILES

```bash
# Development
npm run dev

# Testing
npm test
npm run test:watch

# Type checking
npm run type-check

# Build
npm run build

# Deploy to testnet
npm run deploy:testnet
```

## RECURSOS

- Crossmint POC (referencia): https://github.com/paltalabs/crossmint-poc
- Crossmint Docs: https://docs.crossmint.com
- Crossmint React Wallets: https://docs.crossmint.com/wallets/quickstarts/react
- Crossmint Wallets SDK: https://www.npmjs.com/package/@crossmint/wallets-sdk
- Allbridge Core Docs: https://docs-core.allbridge.io
- Stellar Docs: https://developers.stellar.org
- Base Docs: https://docs.base.org

---

Implementa esto fase por fase. No avances a la siguiente fase hasta que la actual
esté 100% completa y testeada. Pregúntame si tienes dudas antes de empezar cada fase.

---

# 📊 PLANIFICACIÓN CON HITOS CLAVE

## Gantt Simplificado (7 días)

```md
Día 1 | ████████████░░░░░░░░░░░░░░░░░░░░░░ | Setup + Crossmint Wallets
Día 2 | ░░░░░░░░░░░░████████████░░░░░░░░░░ | Allbridge SDK
Día 3 | ░░░░░░░░░░░░░░░░░░░░░░░░████████░░ | UI Components
Día 4 | ░░░░░░░░░░░░░░░░░░░░░░░░░░░░████░░ | Bridge Flow + Status
Día 5 | ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██ | Vault Integration
Día 6 | ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ | Error Handling + Polish
Día 7 | ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ | Testing + Docs
```

## 🎯 Hitos con Métricas Medibles

### Hito 1: "First Connection" (Fin Día 1)

**Meta:** Usuario puede conectar ambas wallets y ver balances

**Métricas:**

- ✅ Crossmint login success rate (email/Google): 100%
- ✅ Stellar smart wallet auto-created via createOnLogin: Sí
- ✅ Base smart wallet created via CrossmintWallets SDK: Sí
- ✅ USDC balance displays correctly: Sí
- ✅ Page load time: < 3s

**Demo:** Screenshot de UI con usuario autenticado y ambas wallets visibles

---

### Hito 2: "Fee Calculator Works" (Fin Día 2)

**Meta:** Cálculo de fees funciona correctamente

**Métricas:**

- ✅ Fee calculation time: < 1s
- ✅ Fee accuracy: ±0.01 USDC
- ✅ Gas estimate within 10% of actual
- ✅ Console logs showing correct values

**Demo:** Video de 30s cambiando amounts y viendo fees actualizarse

---

### Hito 3: "UI Complete" (Fin Día 3)

**Meta:** UI completa y responsive sin funcionalidad backend

**Métricas:**

- ✅ Mobile responsiveness: 320px - 768px
- ✅ Desktop responsiveness: > 768px  
- ✅ Lighthouse accessibility: > 90
- ✅ No TypeScript errors: 0
- ✅ Component render time: < 100ms

**Demo:** Screenshots en 3 tamaños (mobile, tablet, desktop)

---

### Hito 4: "First Successful Bridge" (Fin Día 4)

**Meta:** Bridge funcional en testnet end-to-end

**Métricas:**

- ✅ Bridge success rate: > 80%
- ✅ Transaction time: < 10 min
- ✅ Status updates frequency: every 10s
- ✅ Error rate: < 20%
- ✅ TX appears in explorer: Sí

**Demo:** Video de 2min de bridge completo con status tracking

---

### Hito 5: "Full Flow Works" (Fin Día 5)

**Meta:** Bridge + Deposit en vault funciona completo

**Métricas:**

- ✅ Complete flow success rate: > 70%
- ✅ Total time (bridge + deposit): < 15 min
- ✅ Vault shares received: Sí
- ✅ User can see shares in portfolio: Sí

**Demo:** Video de 3min mostrando flujo completo

---

### Hito 6: "Production Ready" (Fin Día 6)

**Meta:** Error handling completo, UX pulida

**Métricas:**

- ✅ Error recovery rate: 100%
- ✅ User can retry failed txs: Sí
- ✅ Mobile UX score (user testing): > 4/5
- ✅ Loading states implemented: 100%
- ✅ Error messages clear: User tested

**Demo:** Video mostrando cada error scenario y recovery

---

### Hito 7: "Launch Ready" (Fin Día 7)

**Meta:** Tests pasan, docs completas, listo para merge

**Métricas:**

- ✅ Test coverage: > 70%
- ✅ All tests passing: 100%
- ✅ Documentation pages: ≥ 1 (README)
- ✅ Code review approved: Sí
- ✅ Performance budget met: Sí
  - Bundle size increase: < 100kb
  - Time to Interactive: < 3s

**Demo:** PR ready para merge con checklist completo

---

## 📈 KPIs Post-Launch (Medir después de 1 semana)

1. **Adoption Rate**
   - % de usuarios que usan bridge vs deposit directo
   - Target: > 20% de new users

2. **Success Rate**
   - % de bridges completados exitosamente
   - Target: > 90%

3. **User Satisfaction**
   - Net Promoter Score
   - Target: > 7/10

4. **Performance**
   - Average bridge time
   - Target: < 5 min

5. **Support Tickets**
   - n° de tickets relacionados a bridge
   - Target: < 5 en primera semana

---

## 🚨 Blockers Potenciales y Mitigación

| Blocker | Probabilidad | Impacto | Mitigación |
|---------|-------------|---------|------------|
| Allbridge SDK bugs | Media | Alto | Tener backup plan con Axelar |
| Testnet tokens unavailable | Alta | Bajo | Usar faucets, contactar Allbridge |
| Crossmint multi-chain (Base+Stellar) issues | Media | Alto | Fallback: Crossmint solo Stellar + wagmi/MetaMask para Base |
| Bridge timeout en mainnet | Media | Medio | Implementar retry logic robusto |
| Trustline creation fails | Baja | Medio | Clear error messages, manual fallback |
