// ========== src/index.js ==========
import app from './app.js';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`\n✅ Server running at http://localhost:${PORT}`);
  console.log(`📋 API: http://localhost:${PORT}/api/candidates`);
  console.log(`🏥 Health: http://localhost:${PORT}/health\n`);
});

