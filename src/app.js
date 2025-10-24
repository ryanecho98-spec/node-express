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

// ========== HELPER FUNCTIONS ==========

// Convert postcode to coordinates using postcodes.io API
async function getCoordinatesFromPostcode(postcode) {
  if (!postcode) return null;
  
  try {
    const clean = postcode.replace(/\s+/g, '').toUpperCase();
    const response = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}`);
    const data = await response.json();
    
    if (data.status === 200 && data.result) {
      return {
        lat: data.result.latitude,
        lon: data.result.longitude,
        postcodeDistrict: data.result.outward_code // e.g., "M1", "B15"
      };
    }
  } catch (error) {
    console.warn('⚠️ Postcode lookup failed for:', postcode);
  }
  
  return null;
}

// ========== ROUTES ==========

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'production'
  });
});

// Get all candidates with coordinates (no postcode exposed)
app.get('/api/candidates', async (req, res) => {
  try {
    console.log('📋 Fetching candidates from Supabase...');
    
    // Fetch public candidate data
    const { data: publicData, error: publicError } = await supabase
      .from('candidates_public')
      .select('*')
      .order('created_at', { ascending: false });
    
    // Fetch private postcode data (NOT exposed to frontend)
    const { data: privateData, error: privateError } = await supabase
      .from('candidates_private')
      .select('candidate_id, postcode')
      .order('created_at', { ascending: false });

    if (publicError) {
      console.error('❌ Supabase public error:', publicError);
      return res.status(400).json({ error: publicError.message });
    }

    if (!publicData || publicData.length === 0) {
      console.log('⚠️ No candidates found');
      return res.json([]);
    }

    console.log(`✅ Found ${publicData.length} public candidates`);

    // Convert postcodes to coordinates
    const candidates = await Promise.all(publicData.map(async (c) => {
      const privateRecord = privateData?.find(p => p.candidate_id === c.candidate_id);
      
      let coordinates = null;
      let postcodeDistrict = null;
      
      // Get coordinates from postcode if available
      if (privateRecord?.postcode) {
        const coords = await getCoordinatesFromPostcode(privateRecord.postcode);
        if (coords) {
          coordinates = {
            lat: coords.lat,
            lon: coords.lon
          };
          postcodeDistrict = coords.postcodeDistrict;
        }
      }
      
      return {
        id: c.id,
        candidateId: c.candidate_id,
        role: c.job_title,
        location: c.city,
        postcodeDistrict: postcodeDistrict, // e.g., "M1" - safe to expose
        coordinates: coordinates, // lat/lon only - postcode NOT exposed
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
      };
    }));

    console.log(`📤 Returning ${candidates.length} candidates with coordinates`);
    res.json(candidates);

  } catch (error) {
    console.error('🔴 Error in /api/candidates:', error);
    res.status(500).json({ error: 'Failed to fetch candidates', details: error.message });
  }
});

// Get single candidate by ID with coordinates (no postcode exposed)
app.get('/api/candidates/:id', async (req, res) => {
  try {
    console.log(`📋 Fetching candidate: ${req.params.id}`);
    
    // Fetch public data
    const { data: publicData, error: publicError } = await supabase
      .from('candidates_public')
      .select('*')
      .eq('candidate_id', req.params.id)
      .single();
    
    // Fetch private postcode data
    const { data: privateData, error: privateError } = await supabase
      .from('candidates_private')
      .select('candidate_id, postcode')
      .eq('candidate_id', req.params.id)
      .single();

    if (publicError) {
      console.error('Error:', publicError);
      return res.status(404).json({ error: 'Candidate not found' });
    }

    let coordinates = null;
    let postcodeDistrict = null;
    
    // Get coordinates from postcode
    if (privateData?.postcode) {
      const coords = await getCoordinatesFromPostcode(privateData.postcode);
      if (coords) {
        coordinates = {
          lat: coords.lat,
          lon: coords.lon
        };
        postcodeDistrict = coords.postcodeDistrict;
      }
    }

    const candidate = {
      id: publicData.id,
      candidateId: publicData.candidate_id,
      role: publicData.job_title,
      location: publicData.city,
      postcodeDistrict: postcodeDistrict,
      coordinates: coordinates,
      yearsExperience: publicData.years_experience,
      availability: publicData.status || 'Unknown',
      sector: publicData.sector,
      workType: publicData.work_type,
      machines: publicData.machines ? publicData.machines.split(',').map(m => m.trim()).filter(m => m && m !== 'None selected') : [],
      products: publicData.products ? publicData.products.split(',').map(p => p.trim()).filter(p => p && p !== 'None selected') : [],
      materials: publicData.materials ? publicData.materials.split(',').map(m => m.trim()).filter(m => m && m !== 'None selected') : [],
      sewingTechniques: publicData.sewing_techniques ? publicData.sewing_techniques.split(',').map(t => t.trim()).filter(t => t && t !== 'None selected') : [],
      desiredSalary: publicData.desired_salary || 'Competitive',
      travelDistance: publicData.travel_distance
    };

    res.json(candidate);
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
