import { app } from './app.js';
import { initSchema } from './db.js';

const PORT = Number(process.env.PORT) || 3000;

initSchema();

app.listen(PORT, () => {
    console.log(`API lancée sur http://localhost:${PORT}`);
});