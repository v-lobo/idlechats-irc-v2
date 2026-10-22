# IdleChats IRC V2

**Presença nos chats da Twitch em segundo plano, com várias contas e sem abrir uma aba por canal.**

O IdleChats é um aplicativo para Windows feito com Electron. Ele usa uma conexão IRC por conta Twitch, prioriza os canais ao vivo e recupera conexões após falhas de rede. A versão 2.1.0 também inclui um painel experimental do Discord, com login persistente e indicador da sala de voz.

[Baixar versão mais recente](https://github.com/v-lobo/idlechats-irc-v2/releases/latest) · [Reportar um problema](https://github.com/v-lobo/idlechats-irc-v2/issues)

## Recursos

- **Várias contas Twitch:** cada conta tem sua própria autorização e conexão IRC.
- **5 canais conectados por conta:** os canais ao vivo têm prioridade, com a opção de conectar somente a eles.
- **Recuperação automática:** reconexão após falhas de rede e suspensão do computador, além de renovação das sessões Twitch.
- **Execução na bandeja:** mantenha o app funcionando com a janela principal fechada.
- **Diagnóstico integrado:** teste a renovação de sessão e a volta aos chats pelo próprio aplicativo.
- **Discord incorporado:** sessão separada, modo compacto e indicação da conexão de voz.
- **Métricas no rodapé:** memória privada aproximada, uso agregado de CPU e presenças IRC confirmadas.

A integração Twitch não exibe, salva nem envia mensagens de chat. O painel Discord carrega a interface web do próprio Discord e consome recursos adicionais.

## Índice

- [Instalação](#instalação)
- [Primeiros passos](#primeiros-passos)
- [Discord](#discord)
- [Dados e privacidade](#dados-e-privacidade)
- [Atualização](#atualização)
- [Solução de problemas](#solução-de-problemas)

## Instalação

### Requisitos

- Windows 10 ou posterior.
- [Node.js](https://nodejs.org/en/download/) **22.12 ou posterior**, com npm e a opção de adicionar ao `PATH` habilitada na instalação.
- Internet para baixar as dependências e conectar aos serviços.

### Pelo lançador

1. Acesse a [última Release](https://github.com/v-lobo/idlechats-irc-v2/releases/latest) e baixe **Source code (zip)**.
2. Extraia o ZIP para uma pasta no computador.
3. Abra **`Abrir IdleChats.vbs`**.

Na primeira execução, o lançador instala as dependências e baixa o Electron. Aguarde a abertura da janela. Se houver falha, consulte `install-electron.log` na pasta do aplicativo.

### Pelo terminal

Se você tem Git instalado, execute no PowerShell:

```powershell
git clone https://github.com/v-lobo/idlechats-irc-v2.git
cd idlechats-irc-v2
npm ci
npm start
```

Se baixou o ZIP, abra o terminal na pasta extraída e execute apenas `npm ci` e `npm start`.

## Primeiros passos

1. Clique em **+**, ao lado de **Contas Twitch**.
2. Siga as instruções de autorização em `twitch.tv/activate`. Confira se está usando a conta desejada no navegador.
3. Repita o processo para cada conta que quiser adicionar.
4. Confira a lista em **Canais → Cadastrados**. Para incluir outro canal, use **Adicionar canal** e informe o nome, como `nome_do_canal`.
5. Escolha se deseja manter **Somente ao vivo** ativado e clique em **Iniciar IRC**.
6. Ative **Minimizar na bandeja** se quiser fechar a janela principal sem interromper as conexões.

O Client ID público já vem integrado: você não precisa criar uma aplicação no console da Twitch nem configurar um Client Secret.

### Como os canais são escolhidos

O app seleciona até **cinco canais da lista para cada conta**, dando prioridade aos que estão ao vivo. Todas as contas usam essa mesma seleção. Entre canais no mesmo estado, vale a ordem cadastrada.

Com **Somente ao vivo** ativado, apenas canais identificados como ao vivo entram na seleção. O status é consultado a cada minuto por um serviço experimental de terceiros, o DecAPI, e pode atrasar ou falhar. Use **Verificar** para solicitar uma nova consulta.

### Pausar ou encerrar

- **Parar conexões** interrompe o IRC da Twitch.
- Com **Minimizar na bandeja** ativado, fechar a janela principal mantém o app executando.
- **Sair**, no menu da bandeja, encerra o aplicativo, as conexões Twitch e o painel Discord.

## Discord

O Discord abre em uma janela do IdleChats, com uma sessão separada do Discord instalado e das contas Twitch.

1. Clique em **Abrir Discord** e entre com a conta secundária usando e-mail e senha ou QR code. Conclua as verificações solicitadas pelo Discord.
2. A sala padrão já vem configurada. Para alterá-la, abra **Trocar link da sala**, cole um endereço no formato `https://discord.com/channels/servidor/sala` e clique em **Salvar**.
3. Use **Ir para sala** e confirme a entrada pelos controles do Discord. Abrir o endereço não conecta automaticamente à voz.
4. Ative **Modo compacto** para reduzir a barra do IdleChats e ocultar as listas de servidores e membros. Desative para acessar o layout completo.
5. Use **Ocultar e manter aberto** para deixar o painel em segundo plano. Fechar a janela Discord também a oculta.

**Encerrar**, no painel principal, fecha a página e interrompe sua conexão, preservando o login para a próxima abertura. Para sair da conta, use as configurações do próprio Discord. Sessões expiradas ou revogadas exigem novo login.

### Indicador de voz

| Estado | Significado |
| --- | --- |
| **Discord ativo** | O painel mostra voz conectada ao servidor e à sala configurados. |
| **Outra sala** | Há conexão de voz confirmada, mas em outro canal ou servidor. |
| **Fora da sala** / **Conectando voz** | O Discord informa ausência de conexão ou conexão em andamento. |
| **Faça login** / **Sem conexão** | A interface indica que é necessário entrar na conta ou recuperar a conexão. |
| **Não verificado** | Não foi possível confirmar a sala ou a leitura está desatualizada. |

A leitura é renovada a cada cinco segundos, inclusive com a janela oculta. Após 15 segundos sem leitura válida, a presença deixa de ser confirmada. Ter a página aberta não comprova conexão de voz.

### Limitações

- Microfone, câmera, compartilhamento de tela e outras permissões são negados. A saída de áudio permanece silenciada pelo Electron.
- Se o Discord exigir acesso ao microfone para entrar em voz, esta versão não concede essa permissão.
- Passkeys/chaves de acesso estão desativadas na página incorporada. Use e-mail e senha ou QR code; a segunda etapa de autenticação continua sendo exigida quando aplicável.
- Não há reconexão automática de voz nem contador de presença. Quedas de rede e suspensão podem interromper a conexão.
- Mudanças no layout ou idioma do Discord podem afetar o indicador e o modo compacto.

## Dados e privacidade

Os dados locais ficam em:

```text
%APPDATA%\IdleChats IRC V2
```

| Dados | Armazenamento e uso |
| --- | --- |
| Contas Twitch | Tokens criptografados pelo armazenamento seguro do Windows, via Electron `safeStorage`. |
| Canais e preferências | Arquivos locais na pasta de dados do aplicativo. |
| Sessão Discord | Partição persistente `persist:idle-chats-discord-secondary`, dentro da pasta de dados. |
| Diagnóstico de conexão | `connections.log` e uma cópia anterior, `connections.log.1`; limite de 256 KB por arquivo. |

## Atualização

As atualizações são **manuais**. Clique no número da versão, no cabeçalho, para consultar as Releases. Quando houver uma versão nova, clique novamente para abrir a página de download.

1. Encerre o aplicativo pela opção **Sair** da bandeja.
2. Baixe **Source code (zip)** da [Release mais recente](https://github.com/v-lobo/idlechats-irc-v2/releases/latest).
3. Extraia para uma pasta nova e execute `Abrir IdleChats.vbs`.

As contas, os canais e as preferências permanecem na pasta de dados do Windows e são reutilizados pela nova versão.

Se preferir substituir os arquivos na pasta existente, execute `npm ci` nessa pasta antes de abrir o app. Isso sincroniza as dependências com o novo `package-lock.json`; o lançador não reinstala automaticamente um Electron que já esteja presente.

## Solução de problemas

### O lançador não abre ou a instalação falha

Confira as versões no PowerShell:

```powershell
node --version
npm --version
```

É necessário Node.js 22.12 ou posterior. Se os comandos não forem encontrados, reinstale o Node.js com npm e a opção de adicionar ao `PATH`. Após a instalação, reabra o terminal e o lançador; se necessário, reinicie o computador.

Para erros de download ou instalação do Electron, consulte `install-electron.log`. Você também pode executar `npm ci` na pasta do projeto para acompanhar a instalação pelo terminal.

### As contas ficam em “Reconectando”

Confira a internet e passe o mouse sobre o status da conta para ver o motivo e o prazo da próxima tentativa. O app usa intervalos progressivos entre reconexões.

Para tentar manualmente, clique em **Parar conexões** e depois em **Iniciar IRC**. Se necessário, encerre pela bandeja e abra novamente. Consulte `connections.log` na pasta de dados para investigar quedas, retomadas e falhas de renovação.

Se a sessão exigir nova autorização, use **+** para entrar novamente com a mesma conta. O app atualiza o perfil existente e preserva os canais.

### Nenhum canal recebe presença

Confira se há contas autorizadas, se o IRC está iniciado e se existem canais elegíveis. Com **Somente ao vivo** ativado, canais offline ou ainda não identificados como ao vivo não são selecionados. Lembre-se do limite de cinco canais por conta.

### Aparece “missing client secret” ou “Configuração Twitch”

O cadastro Twitch integrado precisa ser do tipo **Public**. Esse erro exige uma correção pelo responsável do projeto; usuários não precisam criar um cadastro próprio. Após uma atualização que troque o Client ID, autorize novamente cada conta pelo botão **+**.

### O Discord está aberto, mas a presença não é confirmada

Confira se o login foi concluído, se o link salvo corresponde à sala desejada e se você entrou na voz pelos controles do Discord. Use **Recarregar** se a página não responder. O estado **Não verificado** significa que o app não conseguiu confirmar a conexão pela interface.

### Testar renovação e reconexão

Com o IRC iniciado e pelo menos um canal selecionado, abra **Diagnóstico** no rodapé:

- **Testar renovação:** renova e valida a sessão, salva os tokens e verifica a volta aos chats.
- **Testar reconexão:** reinicia o IRC e verifica a volta aos chats selecionados.

Os testes interrompem brevemente a presença e não enviam mensagens. O resultado **Passou** exige confirmação dos JOINs em até 60 segundos; mudanças nos canais selecionados durante o teste podem resultar em **Inconclusivo**.

Para conferir a recuperação após uma queda real, desconecte a internet por um minuto, reconecte e aguarde até dois minutos. Você também pode testar a suspensão e retomada do computador. As renovações de sessão aparecem no log como `token-refreshed`.

### Reportar problemas

Abra uma [issue](https://github.com/v-lobo/idlechats-irc-v2/issues) com a versão do app, a versão do Windows, os passos para reproduzir e o resultado esperado. Quando relevante, inclua o trecho do log correspondente à falha, revisando os dados antes de compartilhar. Não envie arquivos de sessão, tokens ou senhas.
