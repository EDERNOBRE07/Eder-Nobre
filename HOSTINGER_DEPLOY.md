# 🚀 Guia de Implantação (Deployment) na Hostinger

Este guia descreve o passo a passo completo para publicar o aplicativo de classificação e monitoramento de ações parlamentares em um subdomínio da **Hostinger**.

Como este é um aplicativo full-stack moderno construído com **React (Vite)** no front-end, **Express (Node.js)** no back-end e **PostgreSQL** com **Firebase Auth**, você precisará utilizar a hospedagem **Node.js** da Hostinger (disponível nos planos VPS ou Hospedagem de Sites Business/Cloud com suporte a SSH e Node.js).

---

## 📋 Pré-requisitos na Hostinger

1. **Subdomínio criado**: Crie o subdomínio desejado (ex: `painel.seudominio.com`) no seu painel da Hostinger (hPanel).
2. **Banco de Dados PostgreSQL**: Crie um novo banco de dados PostgreSQL no hPanel (Seção *Bancos de Dados* -> *Bancos de Dados PostgreSQL*). Guarde os seguintes dados:
   - Host do Banco (ex: `localhost` ou o IP fornecido pela Hostinger)
   - Nome do Banco de Dados
   - Usuário do Banco de Dados
   - Senha do Usuário
3. **Chave de API do Gemini**: Tenha sua chave `GEMINI_API_KEY` gerada no Google AI Studio.

---

## 📦 Passo 1: Exportar o Aplicativo do AI Studio

No canto superior direito da tela do **AI Studio Build**, clique no menu de configurações (ícone de engrenagem) e selecione **"Export to ZIP"**. Isso baixará todo o código-fonte atualizado e limpo diretamente para o seu computador.

---

## 🛠️ Passo 2: Preparar o Arquivo de Configuração Ambiental (.env)

Crie um arquivo chamado `.env` na raiz do projeto extraído (você pode se basear no `.env.example`). Preencha-o com as suas credenciais de produção da Hostinger:

```env
# Porta do Servidor (deixe vazia para que a Hostinger defina dinamicamente)
PORT=3000

# Conexão com o PostgreSQL da Hostinger
SQL_HOST=localhost
SQL_DB_NAME=seu_banco_de_dados
SQL_USER=seu_usuario_do_banco
SQL_PASSWORD=sua_senha_do_banco

# Chave da API do Gemini (AI Studio)
GEMINI_API_KEY=AIzaSy...

# Nota: O arquivo firebase-applet-config.json já está incluído no pacote
# para manter a autenticação ativa e funcional.
```

---

## 📤 Passo 3: Enviar os Arquivos para a Hostinger

1. Compacte novamente a pasta do projeto em um arquivo `.zip` (garanta que o arquivo `.env` e a pasta `src` estejam incluídos).
2. Acesse o **Gerenciador de Arquivos** da Hostinger para o seu subdomínio.
3. Envie o arquivo `.zip` para a pasta raiz do subdomínio (geralmente dentro de `public_html/painel` ou na pasta designada para o app Node.js).
4. Extraia todos os arquivos do `.zip` diretamente lá.

---

## ⚙️ Passo 4: Configurar o Aplicativo Node.js no hPanel

Na Hostinger, o gerenciamento de aplicativos Node.js é simples:

1. No painel da Hostinger (hPanel), navegue até a seção **Node.js** (se estiver usando uma hospedagem que tenha o gerenciador gráfico) ou use o terminal **SSH** (recomendado para controle total).
2. Caso use o gerenciador gráfico do hPanel:
   - Defina a **Versão do Node.js** como **v20** ou mais recente.
   - Defina o **Diretório do App** como a pasta onde você extraiu os arquivos.
   - Defina o **Script de Inicialização** ou **Arquivo de Entrada** como `dist/server.cjs` (ou use o comando `npm start`).
3. Clique em **Instalar Dependências** (isso executará `npm install`).

---

## 🖥️ Passo 5: Construir o Aplicativo e Sincronizar o Banco (Via SSH)

Para gerar o build de produção do React e configurar as tabelas no seu PostgreSQL, conecte-se via SSH à sua conta Hostinger:

1. Acesse o diretório do seu projeto:
   ```bash
   cd /caminho/para/o/seu/subdominio
   ```

2. Instale as dependências caso ainda não tenha feito:
   ```bash
   npm install
   ```

3. **Crie e sincronize as tabelas no PostgreSQL da Hostinger**:
   O projeto utiliza o Drizzle ORM. Para criar as tabelas `records`, `users` e `execution_logs` automaticamente no seu novo banco PostgreSQL da Hostinger, execute:
   ```bash
   npx drizzle-kit push
   ```
   *Isso lerá o esquema de `/src/db/schema.ts` e aplicará as tabelas diretamente na Hostinger sem precisar digitar SQL manualmente.*

4. **Gere o Build de Produção do Aplicativo**:
   Compile o front-end em arquivos estáticos de alto desempenho e empacote o servidor Express executando:
   ```bash
   npm run build
   ```
   *Este comando gerará a pasta `dist` contendo o front-end otimizado e o arquivo `dist/server.cjs` pronto para produção.*

---

## 🏃 Passo 6: Iniciar o Servidor

Agora que tudo está configurado, inicie o aplicativo!

Se você estiver usando o gerenciador gráfico de Node.js da Hostinger, basta clicar em **Iniciar App**.

Caso esteja usando SSH e queira manter o aplicativo rodando em segundo plano mesmo após fechar o terminal, recomendamos usar o **PM2** (gerenciador de processos Node.js padrão do mercado):

1. Instale o PM2 globalmente na sua conta (se permitido) ou localmente:
   ```bash
   npm install pm2 -g
   ```
2. Inicie o app:
   ```bash
   pm2 start dist/server.cjs --name "painel-parlamentar"
   ```
3. Para garantir que o app reinicie se o servidor da Hostinger cair:
   ```bash
   pm2 save
   ```

Pronto! Seu sistema de controle parlamentar integrado com Google Drive, Inteligência Artificial Gemini 3.5 Flash e prevenção de duplicados está 100% publicado e online no seu subdomínio Hostinger! 🎉

---

## 🛠️ Solução de Problemas: O botão "Entrar com Google" não funciona no Domínio Customizado

Quando você hospeda o projeto sob um domínio customizado (como `https://matrizmvpsdb.mastervisionmarketing.com/`), o Google Login via Firebase Authentication falhará com erro de segurança a menos que o domínio esteja explicitamente autorizado. Para corrigir isso e fazer o login funcionar perfeitamente:

### Passo A: Autorizar o Domínio no Firebase Console
1. Acesse o [Firebase Console](https://console.firebase.google.com/).
2. Abra o projeto correspondente à sua aplicação (verifique o `projectId` em `/firebase-applet-config.json`, que por padrão é `gen-lang-client-0337601108`).
3. No menu lateral esquerdo, vá em **Autenticação (Authentication)** e depois clique na aba **Configurações (Settings)** na parte superior.
4. Na lista de seções, clique em **Domínios Autorizados (Authorized Domains)**.
5. Clique em **Adicionar Domínio (Add Domain)**.
6. Digite seu domínio de produção sem o `https://` (ex: `matrizmvpsdb.mastervisionmarketing.com`) e clique em **Adicionar**.

### Passo B: Autorizar as Origens no Google Cloud Console
1. Acesse o [Google Cloud Console](https://console.cloud.google.com/).
2. No topo da página, selecione o mesmo projeto do Firebase (`gen-lang-client-0337601108` ou o correspondente).
3. No menu lateral esquerdo, vá em **APIs e Serviços (APIs & Services)** -> **Credenciais (Credentials)**.
4. Na seção **IDs de cliente OAuth 2.0 (OAuth 2.0 Client IDs)**, clique para editar o cliente Web (geralmente chamado de `Web client (auto-created by Google Service)`).
5. Na seção **Origens JavaScript autorizadas (Authorized JavaScript origins)**, clique em **Adicionar URI** e adicione o seu domínio customizado completo (ex: `https://matrizmvpsdb.mastervisionmarketing.com`).
6. Na seção **URIs de redirecionamento autorizadas (Authorized redirect URIs)**, certifique-se de que a URL de callback do Firebase está presente. Ela deve se parecer com: `https://gen-lang-client-0337601108.firebaseapp.com/__/auth/handler` (ou substitua pelo subdomínio correspondente ao ID do seu projeto Firebase).
7. Clique em **Salvar (Save)** na parte inferior da página.

*Nota: As alterações de DNS e de segurança do Google Cloud Console podem levar de 5 a 15 minutos para propagar completamente. Após essa configuração, o login com o Google no seu site de produção funcionará com total sucesso!*

