# IdleChats IRC V2

Repositório desta versão: [v-lobo/idlechats-irc-v2](https://github.com/v-lobo/idlechats-irc-v2). A versão 2.1.0 adiciona o Discord integrado, com sessão persistente e indicação da sala de voz conectada.

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

## Testar renovação e reconexão

Com o IRC iniciado e ao menos um canal selecionado, abra **Diagnóstico** no rodapé:

1. **Testar renovação** força o mesmo fluxo usado na renovação automática, sem esperar o token expirar: renova a sessão, salva os tokens, valida a autorização e confirma os JOINs nos chats.
2. **Testar reconexão** reinicia as conexões IRC e confirma que as contas voltam aos chats selecionados.

O resultado aparece por conta. O app só informa **Passou** depois dos JOINs confirmados; se os canais selecionados mudarem durante o teste, ele informa **Inconclusivo**. A recuperação dos chats tem prazo de 60 segundos. Os testes interrompem a presença brevemente e não enviam mensagens de chat. Não é necessário sair da conta nem alterar o relógio do Windows.

Para conferir a recuperação em condições reais, você também pode desconectar a internet por um minuto, reconectar e aguardar até dois minutos. Em outro teste, suspenda o computador e depois retome. As contas devem voltar ao IRC e recuperar as presenças automaticamente. Esses testes manuais complementam o diagnóstico; não garantem disponibilidade contínua da rede ou da Twitch.

As renovações são registradas como `token-refreshed` em `connections.log`, sem incluir os tokens. Deixar o app aberto até a próxima renovação automática permite acompanhar também o funcionamento ao longo do tempo.

## Verificações de desenvolvimento

Execute `npm test` para simular quedas de rede, conexões sem resposta, reconexão da Twitch, retomada do computador, renovação simultânea de contas e gravação concorrente dos dados, sem usar contas Twitch reais.

## Discord incorporado (experimental)

O painel Discord abre uma janela do próprio IdleChats com o Discord web incorporado. A Twitch continua usando IRC; o Discord mantém uma página Chromium em execução e consome recursos adicionais.

1. Clique em **Abrir Discord** e faça login com a conta secundária. O cadastro da conta e eventuais verificações são feitos pelo Discord.
2. A sala padrão é `https://discord.com/channels/1516313244057337908/1551936385030824056` e abre automaticamente ao iniciar a janela Discord. Para mudar o endereço, use o controle discreto **Trocar link da sala** e salve o novo link. Um link personalizado já salvo é preservado.
3. Use **Ir para sala** e confirme a entrada pelos controles do Discord. Abrir o link não garante entrada automática.
4. Ative **Modo compacto** para reduzir a barra do IdleChats, ocultar as instruções e as listas laterais de servidores e membros. A barra diminui de 156 para 100 pixels, deixando mais espaço para a sala. Desative para voltar ao layout completo, trocar de servidor ou resolver problemas de navegação. A simplificação usa CSS e pode precisar de ajuste após mudanças do Discord.
5. Use **Ocultar e manter aberto**. Fechar a janela Discord também a oculta. Ative **Minimizar na bandeja** no painel principal para manter todo o IdleChats executando ao fechar sua janela principal.
6. **Encerrar** destrói a página e encerra sua conexão, preservando o login. Para sair da conta, use as configurações do próprio Discord. Sair do IdleChats encerra também o Discord.

A sessão persiste na partição `persist:idle-chats-discord-secondary`, dentro dos dados do IdleChats IRC V2, separada da Twitch e do Discord instalado. O código não extrai tokens pessoais nem automatiza chamadas à API do Discord. O conteúdo remoto não tem acesso a Node.js nem à ponte de comandos do aplicativo.

Ao usar **Encerrar** ou sair do IdleChats, o app aguarda o evento normal de saída da página do Discord e grava os dados locais e cookies pendentes antes de destruir a janela. Assim, o Discord pode salvar a própria autenticação e reutilizá-la na próxima abertura, sem armazenar sua senha no IdleChats. Sair da conta nas configurações do próprio Discord continua encerrando a autenticação. Uma sessão revogada ou expirada pelo Discord exige novo login.

O login integrado usa e-mail e senha ou o QR do Discord. Solicitações de passkeys/WebAuthn são recusadas antes de chamar o autenticador do Windows, evitando o diálogo “Escolher uma chave de acesso”. Isso se aplica somente à página incorporada no IdleChats; a autenticação da conta continua sendo validada pelo Discord, incluindo a segunda etapa quando exigida.

Microfone, câmera, compartilhamento de tela e outras permissões são negados; a reprodução de áudio fica silenciada pelo Electron, com o bloqueio reaplicado em navegações, início de reprodução e mudanças do estado de áudio. Isso não altera os dispositivos do Windows nem depende dos botões de mute do Discord. Caso o Discord exija permissão de microfone para entrar, esta versão não a concede e será necessário avaliar a compatibilidade. O indicador de voz lê apenas os controles da própria conta no painel do Discord. Ele não usa a URL aberta como prova de conexão nem consulta mensagens de chat, tokens ou módulos internos do Discord. Não há reconexão automática, contador de presença ou confirmação de bônus; confira a elegibilidade da conta secundária no jogo. Suspensão do computador e quedas de rede podem interromper a presença.


### Indicador de presença do Discord

- **Discord ativo** (verde): o painel da conta mostra “Voz conectada” ou “Voice Connected” e o link da conexão corresponde ao servidor e à sala configurados.
- **Outra sala** (amarelo): existe conexão de voz confirmada, mas em outro canal ou servidor.
- **Fora da sala**, **Conectando voz**, **Faça login** ou **Sem conexão**: a interface mostra a condição correspondente.
- **Não verificado**: o painel não pôde ser interpretado, a sala não foi identificada ou a última leitura tem mais de 15 segundos. Uma mudança no layout ou idioma do Discord pode exigir ajustes. O indicador prefere não confirmar a exibir um falso positivo.

A leitura acompanha mudanças no painel e é renovada a cada 5 segundos, inclusive com a janela oculta. O IPC aceita observações somente do documento principal da página `https://discord.com` incorporada na sessão atual. “Discord ativo” confirma o estado mostrado pelo Discord, não o recebimento do bônus no jogo.

### Verificação da integração

`npx electron tests/discord-smoke.cjs` executa um teste com dados temporários, sem acessar contas salvas. Requer acesso à página de login do Discord. Verifica validação do link, isolamento do conteúdo remoto, áudio silenciado, alternância do modo compacto e ciclo de ocultar/reabrir/encerrar. Não testa autenticação nem presença em voz. Capturas ficam em `dist/discord-preview/`.

O indicador acompanha somente o documento principal. Quadros internos e mudanças de rota do Discord não recolocam uma página já aberta em “Carregando”. Se o documento principal não responder em 30 segundos, aparece uma mensagem de demora com a opção de recarregar. “Página aberta” não confirma conexão de voz.

`node --test tests/discord-page-status.test.cjs` verifica as transições do indicador. `npx electron tests/discord-status-smoke.cjs` reproduz o carregamento de um quadro interno lento usando um servidor local e verifica os textos nas duas janelas. Também simula os controles de voz sob uma origem Discord interceptada somente na sessão temporária de teste e verifica sala correta, outra sala, login, desconexão e atualização com a janela oculta. Esses testes não usam contas nem conexões de voz reais.

`npm run test:discord-session` verifica a persistência com dados fictícios em dois processos separados: encerramento da página, reabertura, saída normal do app com a janela oculta e nova execução. Usa um perfil temporário e não acessa a sessão real do usuário.
