
# Crossmint base to stellar PoC

TASKS:

- [x] Publicar repo
- [ ] Script pequeño interacción Crossmint in Base (testnet o mainnet)
- [ ] Script pequeño interacción Crossmint in Stellar (testnet o mainnet)
- [ ] Investigar y script mini POC Near Intents

## Desarrollar un script de inteacción utilizando crossmint smart wallet

El objetivo de este paso es poder configurar y probar el ambiente de crossmint tanto en base como en stellar y utilizar sus smart wallets para llevar a cabo al menos una transacción nativa en cada red, puede ser un token transfer o alguna operación básica para revisar que efectivamente podemos firmar y enviar transacciones en cada una de las blockchains utilizando smart accounts.

Para ello será necesario crear un archivo de config en la carpeta scripts que nos ayudará a mantener nuestra configuración centralizada y así será más fácil de modificar en el futuro y evitamos repetir líneas de código innecesariamente.

En este archivo config se definirá un servidor de crossmint, por lo que es necesario también tener un archivo .env para almacenar las variables de ambiente necesarias para la ejecución de los scripts.

También es importante aclarar que deberían ser dos scripts separados que nos permitan interactuar tanto en base como stellar individualmente.
