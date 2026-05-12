# Movidesk MCP Server

Servidor MCP em TypeScript/Bun para consultar tickets do Movidesk em modo somente leitura.

## Ferramentas

- `get_ticket`: retorna dados principais do ticket e resumo das ultimas interacoes.
- `get_ticket_history`: retorna historico, comentarios, status e interacoes do ticket.
- `get_ticket_attachments`: retorna anexos/imagens associados ao ticket, com metadados, hash e URL de download sem token quando houver hash.

Nenhuma ferramenta cria, altera, exclui ou atualiza tickets.

## Requisitos

- Bun instalado.
- Token da API Movidesk.

## Instalacao

```bash
git clone <url-do-repositorio> movidesk-mcp-server
cd movidesk-mcp-server
bun install
```

## Variaveis De Ambiente

Crie um arquivo `.env` ou configure a variavel no ambiente do MCP client:

```bash
MOVIDESK_TOKEN=seu-token-da-api-movidesk
```

O token nao deve ser versionado ou escrito no codigo.

Um arquivo `.env.example` esta incluido apenas como modelo.

## Execucao

```bash
bun run src/index.ts
```

Ou pelo script:

```bash
bun run start
```

## Configuracao MCP Client

Exemplo generico de configuracao para um cliente MCP via stdio:

```json
{
  "mcpServers": {
    "movidesk": {
      "command": "bun",
      "args": ["run", "C:/MCP Servers/Movidesk/src/index.ts"],
      "env": {
        "MOVIDESK_TOKEN": "seu-token-da-api-movidesk"
      }
    }
  }
}
```

## Configuracao OpenCode

Adicione o servidor no arquivo de configuracao do OpenCode, normalmente em `%USERPROFILE%\.opencode\opencode.json` no Windows.

Exemplo usando pacote publicado e `bunx`:

```json
{
  "mcpServers": {
    "movidesk": {
      "command": "bunx",
      "args": ["movidesk-mcp-server@latest"],
      "env": {
        "MOVIDESK_TOKEN": "seu-token-da-api-movidesk"
      }
    }
  }
}
```

Exemplo usando o script `start` a partir de um repositorio clonado:

```json
{
  "mcpServers": {
    "movidesk": {
      "command": "bun",
      "args": ["run", "--cwd", "C:/caminho/para/movidesk-mcp-server", "start"],
      "env": {
        "MOVIDESK_TOKEN": "seu-token-da-api-movidesk"
      }
    }
  }
}
```

Depois de alterar a configuracao, reinicie o OpenCode e teste pedindo uma consulta de ticket numerico.

## Publicacao

Para publicar como pacote executavel e usar via `bunx`:

```bash
bun install
bun run build
npm publish
```

Depois de publicado, o OpenCode pode iniciar o MCP com `bunx movidesk-mcp-server@latest`.

Antes de publicar, ajuste o `name` no `package.json` se quiser usar um pacote escopado, por exemplo `@sua-org/movidesk-mcp-server`. Nesse caso, a configuracao fica `"args": ["@sua-org/movidesk-mcp-server@latest"]`.

Arquivos recomendados para versionar:

- `bin/`
- `scripts/`
- `src/`
- `package.json`
- `bun.lock`
- `tsconfig.json`
- `README.md`
- `.env.example`
- `.gitignore`

Nao versione `.env`, tokens, logs ou `node_modules/`.

## API Movidesk Utilizada

- Base URL: `https://api.movidesk.com/public/v1`
- Ticket por ID: `GET /tickets?token=TOKEN&id=TICKET_ID`
- Historico/interacoes: `GET /tickets` com `$expand=actions(...)`
- Anexos do ticket: `actions($expand=attachments)`
- Download de anexo: `GET /storage/download?token=TOKEN&id=HASH`; a ferramenta retorna apenas a URL sem `token` e o `hash`.

Observacoes da documentacao Movidesk:

- A rota `/tickets` cobre tickets com `lastUpdate` inferior a 90 dias; tickets antigos podem exigir `/tickets/past`.
- A API possui limite de 10 requisicoes por minuto.
- Em caso de bloqueio por falhas, a API pode retornar `429` e header `retry-after`.
- O servidor serializa chamadas para respeitar aproximadamente 10 requisicoes por minuto.

## Validacao

```bash
bun run typecheck
```

## Seguranca

- O servidor usa apenas `GET`.
- O token e lido exclusivamente de `MOVIDESK_TOKEN`.
- URLs de anexo retornadas pelas ferramentas nao incluem token; use o hash retornado com credenciais fora do historico MCP quando precisar baixar o arquivo.
- Logs sao minimos e nao exibem token.
- Respostas grandes sao truncadas/resumidas antes de retornar ao agente.
