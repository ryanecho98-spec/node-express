// ========== src/index.js (COMPLETE VERSION) ==========
import app from './app.js';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`\n✅ Server running at http://localhost:${PORT}`);
  
  console.log(`\n🔐 AUTHENTICATION:`);
  console.log(`   POST http://localhost:${PORT}/api/login`);
  console.log(`   GET http://localhost:${PORT}/api/profile (requires token)`);
  console.log(`   PUT http://localhost:${PORT}/api/profile/update (requires token)`);
  console.log(`   PUT http://localhost:${PORT}/api/profile/change-password (requires token)`);
  
  console.log(`\n📍 SEWING CANDIDATES (Project: dcspzgkapduwspruzfzk):`);
  console.log(`   GET http://localhost:${PORT}/api/candidates (requires token)`);
  console.log(`   GET http://localhost:${PORT}/api/candidates/:id (requires token)`);
  
  console.log(`\n🛋️  UPHOLSTERY CANDIDATES (Project: bymwguuqgnqzogiilnzz):`);
  console.log(`   GET http://localhost:${PORT}/api/upholstery (requires token)`);
  console.log(`   GET http://localhost:${PORT}/api/upholstery/:id (requires token)`);
  
  console.log(`\n🏥 HEALTH CHECK:`);
  console.log(`   GET http://localhost:${PORT}/health\n`);
});
