# mcp-movidesk

Read-only MCP server for querying Movidesk tickets through the public Movidesk API.

## Requirements

- Bun installed.
- A Movidesk API token.

## OpenCode Configuration

Add this server to your OpenCode configuration file.

On Windows, this is usually:

```text
%USERPROFILE%\.config\opencode\opencode.json
```

Configuration:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "mcp-movidesk": {
      "type": "local",
      "command": ["bunx", "mcp-movidesk@latest"],
      "enabled": true,
      "environment": {
        "MOVIDESK_TOKEN": "your-movidesk-api-token"
      }
    }
  }
}
```

OpenCode expects MCP servers under the `mcp` key. Do not use `mcpServers`, `args`, or `env` for this configuration format.

Restart OpenCode after changing the configuration.

## Tools

- `get_ticket`: returns the main ticket data and a short summary of recent actions.
- `get_ticket_history`: returns ticket history, comments, inline comment images, status changes, and interactions.
- `get_ticket_attachments`: returns ticket attachment metadata plus inline comment images, hashes, and download URLs without the token.
- `get_ticket_inline_image`: downloads one inline comment image by storage hash using the server-side Movidesk token and returns image content without exposing the token.

All tools are read-only. They do not create, update, or delete Movidesk tickets.

## Usage

After configuring OpenCode, ask for a numeric ticket ID, for example:

```text
Use Movidesk to get ticket 123456
```

## Rate Limit

Movidesk allows 10 API requests per minute. This server has a built-in guard that serializes outbound API requests and waits at least 6.1 seconds between them.

Agent guidance:

- Do not call the tools in bulk or in parallel.
- Prefer one ticket lookup at a time.
- Wait for each result before deciding whether another tool call is needed.
- If Movidesk returns `429`, respect the returned `retryAfterSeconds` value.

## Security

- The server only performs `GET` requests.
- The Movidesk token is read from `MOVIDESK_TOKEN`.
- Attachment URLs returned by the tool do not include the token.
- Inline image downloads use the server-side token internally and do not expose it in responses.
- Large responses are summarized or truncated before being returned to the MCP client.
- Requests are serialized to stay close to the Movidesk limit of 10 requests per minute.
