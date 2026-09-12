module.exports = {
  apps: [
    {
      name: "fanside-ai-server",
      cwd: __dirname,
      script: "node_modules/.bin/tsx",
      args: "server/index.ts",
      interpreter: "none",
      env: { NODE_ENV: "production" },
    },
  ],
};
