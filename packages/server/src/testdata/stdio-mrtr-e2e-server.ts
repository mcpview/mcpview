/** Real stdio fixture for the Casys MRTR integrity/replay boundary. */

import { McpApp } from "../mcp-app.ts";

const app = new McpApp({
  name: "e2e-stdio-mrtr",
  version: "1.0.0",
  logger: () => {},
  mrtr: { signingKey: "a".repeat(64) },
});

app.registerTool(
  {
    name: "ask_then_answer",
    description: "Ask for one form response, then report retry verification",
    inputSchema: {
      type: "object",
      properties: { subject: { type: "string" } },
      required: ["subject"],
    },
  },
  (args, context) => {
    const answer = context?.inputResponses?.github_login;
    if (answer !== undefined) {
      return `subject=${args.subject};verified=${context?.retryVerified};answer=${
        JSON.stringify(answer)
      }`;
    }
    return {
      resultType: "input_required",
      inputRequests: {
        github_login: {
          method: "elicitation/create",
          params: {
            mode: "form",
            message: "Your GitHub username?",
            requestedSchema: {
              type: "object",
              properties: { name: { type: "string" } },
              required: ["name"],
            },
          },
        },
      },
    };
  },
);

await app.start();
