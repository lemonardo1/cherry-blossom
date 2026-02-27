const { main } = require("./src/server");

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
