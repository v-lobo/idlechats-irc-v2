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

O registro do app no Twitch Developer Console precisa ter **Client Type: Public**. A visibilidade pública do repositório GitHub não define esse tipo. Cadastros Confidential exigem Client Secret ao renovar sessões; o IdleChats confirma a renovação logo após o login, antes de salvar a sessão. Os usuários do app não precisam criar cadastros próprios no console.

O login usa Device Code Grant e pede `chat:read` e `chat:edit`, exigidos pela conexão IRC da Twitch. O app não oferece recursos para ler ou enviar mensagens: as linhas recebidas pelo protocolo são descartadas em memória.

## Canais e prioridade

Canais ao vivo ficam no topo da lista e têm prioridade para as cinco vagas de cada conta. Entre canais no mesmo estado, o app conserva a ordem cadastrada. A opção **Somente ao vivo** impede conexões com canais offline. O status online é consultado uma vez por minuto por um serviço experimental de terceiros e pode atrasar ou falhar.

## Dados e limitações

- As sessões e os canais ficam na pasta de dados local `IdleChats IRC V2`; não são compartilhados entre usuários nem enviados a este repositório.
- O app renova os tokens antes de expirarem e repete falhas temporárias de rede. Como o app Twitch usa Device Code Grant público, a Twitch pode invalidar refresh tokens após 30 dias sem uso; nesse caso, a conta precisa ser autorizada novamente.
- Conexões sem resposta são recriadas automaticamente. O login IRC tem prazo de 30 segundos; uma checagem de conexão ocorre a cada minuto e aguarda até 30 segundos pela resposta. São comandos de manutenção do protocolo, sem envio de mensagens ao chat.
- Após suspensão do computador ou retorno da rede, o app retoma as conexões e renova sessões expiradas. As tentativas de reconexão têm intervalos progressivos para evitar uma sequência de conexões durante uma queda de internet.
- Cada conta Twitch precisa autorizar individualmente o app.
- O indicador de JOIN IRC confirma a entrada no chat; um jogo ou serviço externo pode demorar alguns minutos para reconhecer a presença.
- Minimizar na bandeja mantém as conexões em execução. Fechar completamente o app desconecta as contas.
- O rodapé mostra memória privada aproximada dos processos do app, uso agregado de CPU e presenças IRC confirmadas.
- Clique no número da versão no cabeçalho para consultar as Releases do GitHub. Se houver atualização, o texto mostra a versão atual e a nova com 💫; clique novamente para abrir a página da versão. Se estiver atualizado, aparece 🆗.

## Atualizar o app

As atualizações são instaladas manualmente. Encerre o app pela opção **Sair** da bandeja. Na página aberta pelo app, baixe **Source code (zip)** da versão mais recente e extraia os arquivos para a pasta do app, substituindo os arquivos da versão anterior. Em seguida, execute `Abrir IdleChats.vbs` novamente; se necessário, o lançador instala as dependências. Os dados locais (contas e canais) ficam em `%APPDATA%\IdleChats IRC V2` e não são substituídos pela atualização.

O verificador usa as **Releases** deste repositório. Para publicar uma atualização, incremente a versão em `package.json` e crie uma Release no GitHub com a tag correspondente no formato `vMAJOR.MINOR.PATCH` (por exemplo, `v2.0.1`).

## Revogar acesso

Remova a conta no app e, se desejar, revogue a autorização do IdleChats nas configurações de conexões da Twitch.

### Se a instalação falhar

O lançador precisa do **Node.js 22.12 ou posterior** e do npm. Instale a versão LTS pelo [site oficial do Node.js](https://nodejs.org/en/download/) e mantenha ativada a opção para adicionar o Node ao PATH. Depois, feche e abra novamente o lançador. Se o Node já estiver instalado e ainda não for encontrado, reinicie o Windows Explorer ou o computador para atualizar o PATH.

Se a instalação do Electron falhar, consulte o arquivo `install-electron.log` na pasta do app. Ele contém os detalhes do erro de instalação ou download.

### Se as contas ficarem em Reconectando

Confira a conexão de internet e passe o mouse sobre o status da conta para ver o motivo e o prazo da tentativa. Para reiniciar as conexões manualmente, clique em **Parar conexões** e depois em **Iniciar IRC**. Se necessário, encerre o app pela bandeja e abra novamente.

O arquivo `%APPDATA%\IdleChats IRC V2\connections.log` registra mudanças de conexão, suspensão, retorno da rede e motivos técnicos das tentativas. Ele não grava tokens nem mensagens de chat. O registro tem limite de 256 KB e mantém uma cópia anterior em `connections.log.1`. Se o problema voltar a acontecer, esses arquivos permitem investigar a sequência de eventos. Uma sessão realmente revogada pela Twitch continuará exigindo autorização novamente.

### Se aparecer missing client secret ou Configuração Twitch

Esse erro exige correção do cadastro Twitch integrado pelo responsável do IdleChats. O app pausa as tentativas e informa a configuração necessária, em vez de tratar a resposta como falha de rede. O responsável deve cadastrar uma aplicação com **Client Type: Public**, integrar o Client ID correspondente e publicar a atualização. A [documentação de renovação da Twitch](https://dev.twitch.tv/docs/authentication/refresh-tokens/) explica quando o Client Secret é dispensado.

Ao atualizar para um Client ID diferente, as contas anteriores pedem uma nova autorização. Use **+** em Contas Twitch e autorize cada conta novamente. O app atualiza o perfil existente, sem duplicar a conta, e conserva os canais cadastrados.

## Verificações de desenvolvimento

Execute `npm test` para simular quedas de rede, conexões sem resposta, reconexão da Twitch, retomada do computador, renovação simultânea de contas e gravação concorrente dos dados, sem usar contas Twitch reais.
