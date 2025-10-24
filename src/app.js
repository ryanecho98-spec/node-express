
// ========== src/app.js ==========
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// Supabase setup
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase environment variables');
  console.error('Make sure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

console.log('✅ Supabase initialized');

// ========== ROUTES ==========

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'production'
  });
});

// Get all candidates
app.get('/api/candidates', async (req, res) => {
  try {
    console.log('📋 Fetching candidates from Supabase...');
    
    const { data, error } = await supabase
      .from('candidates_public')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Supabase error:', error);
      return res.status(400).json({ error: error.message });
    }

    if (!data || data.length === 0) {
      console.log('⚠️ No candidates found');
      return res.json([]);
    }

    console.log(`✅ Found ${data.length} candidates`);

    // Transform data for frontend
    const candidates = data.map(c => ({
      id: c.id,
      candidateId: c.candidate_id,
      role: c.job_title,
      location: c.city,
      yearsExperience: c.years_experience,
      availability: c.status || 'Unknown',
      sector: c.sector,
      workType: c.work_type,
      machines: c.machines ? c.machines.split(',').map(m => m.trim()).filter(m => m && m !== 'None selected') : [],
      products: c.products ? c.products.split(',').map(p => p.trim()).filter(p => p && p !== 'None selected') : [],
      materials: c.materials ? c.materials.split(',').map(m => m.trim()).filter(m => m && m !== 'None selected') : [],
      sewingTechniques: c.sewing_techniques ? c.sewing_techniques.split(',').map(t => t.trim()).filter(t => t && t !== 'None selected') : [],
      desiredSalary: c.desired_salary || 'Competitive',
      travelDistance: c.travel_distance
    }));

    console.log(`📤 Returning ${candidates.length} candidates to frontend`);
    res.json(candidates);

  } catch (error) {
    console.error('🔴 Error in /api/candidates:', error);
    res.status(500).json({ error: 'Failed to fetch candidates', details: error.message });
  }
});

// Get single candidate by ID
app.get('/api/candidates/:id', async (req, res) => {
  try {
    console.log(`📋 Fetching candidate: ${req.params.id}`);
    
    const { data, error } = await supabase
      .from('candidates_public')
      .select('*')
      .eq('candidate_id', req.params.id)
      .single();

    if (error) {
      console.error('Error:', error);
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
    message: `Route ${req.method} ${req.path} does not exist`,
    availableRoutes: [
      'GET /health',
      'GET /api/candidates',
      'GET /api/candidates/:id'
    ]
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('🔴 Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal Server Error',
    message: err.message
  });
});

export default app;
