# IdleChats IRC V2

Aplicativo Electron para manter presença em chats Twitch usando uma conexão IRC por conta. Não abre páginas de chat nem várias janelas de navegador. O app não mostra, salva nem envia mensagens de chat.

## Requisitos

- Windows 10 ou posterior
- Node.js 22.12 ou posterior e npm
- Internet para instalar o Electron e conectar à Twitch

## Iniciar

Clone ou baixe este repositório e abra `Abrir IdleChats.vbs`. Na primeira execução, o lançador instala as dependências do `package-lock.json` e inicia o app. Se a instalação falhar, consulte `install-electron.log` na pasta do app. Também é possível executar:

```powershell
npm ci
npm start
```

## Configuração e login

1. Clique em **+** ao lado de Contas Twitch.
2. Autorize a conta em `twitch.tv/activate` e aceite as permissões solicitadas.
3. Cadastre canais e inicie as conexões IRC.

O Client ID público do IdleChats já vem integrado. Cada usuário autoriza as próprias contas; os tokens ficam criptografados localmente pelo armazenamento seguro do Windows. Não há Client Secret no app.

O login usa Device Code Grant e pede `chat:read` e `chat:edit`, exigidos pela conexão IRC da Twitch. O app não oferece recursos para ler ou enviar mensagens: as linhas recebidas pelo protocolo são descartadas em memória.

## Canais e prioridade

Canais ao vivo ficam no topo da lista e têm prioridade para as cinco vagas de cada conta. Entre canais no mesmo estado, o app conserva a ordem cadastrada. A opção **Somente ao vivo** impede conexões com canais offline. O status online é consultado uma vez por minuto por um serviço experimental de terceiros e pode atrasar ou falhar.

## Dados e limitações

- As sessões e os canais ficam na pasta de dados local `IdleChats IRC V2`; não são compartilhados entre usuários nem enviados a este repositório.
- O app renova os tokens antes de expirarem e repete falhas temporárias de rede. Como o app Twitch usa Device Code Grant público, a Twitch pode invalidar refresh tokens após 30 dias sem uso; nesse caso, a conta precisa ser autorizada novamente.
- Cada conta Twitch precisa autorizar individualmente o app.
- O indicador de JOIN IRC confirma a entrada no chat; um jogo ou serviço externo pode demorar alguns minutos para reconhecer a presença.
- Minimizar na bandeja mantém as conexões em execução. Fechar completamente o app desconecta as contas.
- O rodapé mostra memória privada aproximada dos processos do app, uso agregado de CPU e presenças IRC confirmadas.

## Revogar acesso

Remova a conta no app e, se desejar, revogue a autorização do IdleChats nas configurações de conexões da Twitch.

### Se a instalação falhar

O lançador precisa do **Node.js 22.12 ou posterior** e do npm. Instale a versão LTS pelo [site oficial do Node.js](https://nodejs.org/en/download/) e mantenha ativada a opção para adicionar o Node ao PATH. Depois, feche e abra novamente o lançador. Se o Node já estiver instalado e ainda não for encontrado, reinicie o Windows Explorer ou o computador para atualizar o PATH.

Se a instalação do Electron falhar, consulte o arquivo `install-electron.log` na pasta do app. Ele contém os detalhes do erro de instalação ou download.
