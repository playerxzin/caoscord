# Caos Cord

Primeira base funcional do Caos Cord, feita para rodar sem build complexo.

## O que já existe

- Cadastro/login por usuário e senha (sem e-mail)
- Perfil com nome, @usuário, bio, avatar, banner e verificado
- Regra de troca de @usuário a cada 7 dias
- Servidores e canais de texto/voz
- Mensagens em tempo real com Socket.IO
- Edição e exclusão das próprias mensagens
- Mensagens diretas
- Presença online/offline
- Layout desktop e mobile inspirado em apps de comunidades
- Chamada WebRTC com microfone, câmera e compartilhamento de tela
- PWA instalável no Chrome/Edge/Android
- `render.yaml` para publicação simples

## Rodar no PC

```bash
npm install
npm start
```

Abra: `http://localhost:3000`

## Atenção sobre hospedagem grátis

A versão atual salva os dados em `data.json`. Isso funciona no PC e em servidores com disco persistente. Em alguns hosts gratuitos o disco pode ser temporário; para uso público permanente, o próximo passo é trocar o armazenamento por Supabase/PostgreSQL gratuito.

## WebRTC

A base usa STUN público para chamadas. Em algumas redes restritas, câmera/voz/tela podem exigir um servidor TURN. O código já está organizado para adicionar TURN depois.


## Anti-spam

O servidor limita rajadas de mensagens: ao atingir 5 mensagens em menos de 5 segundos, bloqueia novos envios por 5 segundos e exibe o aviso **“EITA! PERAÍ. SEGURA A ONDA”** no cliente. A regra vale para canais e mensagens diretas.
