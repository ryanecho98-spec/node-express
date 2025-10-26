// ========== src/index.js ==========
import app from './app.js';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`\n✅ Server running at http://localhost:${PORT}`);
  
  console.log(`\n🔐 AUTHENTICATION:`);
  console.log(`   POST http://localhost:${PORT}/api/login`);
  console.log(`   GET http://localhost:${PORT}/api/profile (requires token)`);
  
  console.log(`\n📍 SEWING CANDIDATES (Project: dcspzgkapduwspruzfzk):`);
  console.log(`   GET http://localhost:${PORT}/api/candidates`);
  console.log(`   GET http://localhost:${PORT}/api/candidates/:id`);
  
  console.log(`\n🛋️  UPHOLSTERY CANDIDATES (Project: bymwguuqgnqzogiilnzz):`);
  console.log(`   GET http://localhost:${PORT}/api/upholstery`);
  console.log(`   GET http://localhost:${PORT}/api/upholstery/:id`);
  
  console.log(`\n🏥 HEALTH CHECK:`);
  console.log(`   GET http://localhost:${PORT}/health\n`);
});
