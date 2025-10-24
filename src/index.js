import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// Initialize Supabase with service role key (secure - only on backend)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

console.log('✅ Supabase initialized');

// ========== ROUTES ==========

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get all candidates
app.get('/api/candidates', async (req, res) => {
  try {
    console.log('📋 Fetching candidates...');
    
    const { data, error } = await supabase
      .from('candidates_public')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Database error:', error);
      return res.status(400).json({ error: error.message });
    }

    if (!data || data.length === 0) {
      console.log('⚠️ No candidates found');
      return res.json([]);
    }

    // Transform database records to frontend format
    const candidates = data.map(c => ({
      id: c.id,
      candidateId: c.candidate_id,
      role: c.job_title,
      location: c.city,
      yearsExperience: c.years_experience,
      availability: c.status || 'Unknown',
      sector: c.sector,
      workType: c.work_type,
      machines: c.machines ? c.machines.split(',').map(m => m.trim()).filter(m => m) : [],
      products: c.products ? c.products.split(',').map(p => p.trim()).filter(p => p) : [],
      materials: c.materials ? c.materials.split(',').map(m => m.trim()).filter(m => m) : [],
      sewingTechniques: c.sewing_techniques ? c.sewing_techniques.split(',').map(t => t.trim()).filter(t => t) : [],
      desiredSalary: c.desired_salary || 'Competitive',
      travelDistance: c.travel_distance
    }));

    console.log(`✅ Returning ${candidates.length} candidates`);
    res.json(candidates);

  } catch (error) {
    console.error('🔴 Error:', error);
    res.status(500).json({ error: 'Failed to fetch candidates' });
  }
});

// Get single candidate
app.get('/api/candidates/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('candidates_public')
      .select('*')
      .eq('candidate_id', req.params.id)
      .single();

    if (error) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    res.json(data);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to fetch candidate' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n✅ Server running at http://localhost:${PORT}`);
  console.log(`📋 API: http://localhost:${PORT}/api/candidates`);
  console.log(`🏥 Health: http://localhost:${PORT}/health\n`);
});
