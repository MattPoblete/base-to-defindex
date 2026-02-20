
# Crossmint base to stellar PoC

TASKS:

- [x] Publicar repo
- [x] Script pequeño interacción Crossmint in Base (testnet o mainnet)
- [x] Script pequeño interacción Crossmint in Stellar (testnet o mainnet)
- [ ] Investigar y script mini POC Near Intents

## Desarrollar un script de inteacción utilizando near intents

El objetivo actual es poder realizar una transacción desde base hacia stellar utilizando near intents
Para para ello vamos a generar dos wallets, una en base y otra en stellar y luego agregar fondos de un token de prueba a la wallet de base,
una vez tengamos los tokens en base vamos a lanzar un intent para transferir a stellar

Este script debe ser configurable tanto para testnet como para mainnet en ambas chains y debe entregar durante su ejecución los logs necesarios para entender la etapa del prcoceso en la que se encuentra y mostrar una tabla comparativa al final mostrando los balances de ambas cuentas previo y posterior a la ejecución
