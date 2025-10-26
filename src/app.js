// ========== src/app.js ==========
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcryptjs from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-key-change-this';

// ========== MIDDLEWARE ==========
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// ========== SUPABASE SETUP ==========
// Sewing project
const supabaseUrlSewing = process.env.SUPABASE_URL_SEWING;
const supabaseKeySewing = process.env.SUPABASE_SERVICE_ROLE_KEY_SEWING;

// Upholstery project
const supabaseUrlUpholstery = process.env.SUPABASE_URL_UPHOLSTERY;
const supabaseKeyUpholstery = process.env.SUPABASE_SERVICE_ROLE_KEY_UPHOLSTERY;

if (!supabaseUrlSewing || !supabaseKeySewing) {
  console.error('❌ Missing Sewing Supabase environment variables');
  process.exit(1);
}

if (!supabaseUrlUpholstery || !supabaseKeyUpholstery) {
  console.error('❌ Missing Upholstery Supabase environment variables');
  process.exit(1);
}

const supabaseSewing = createClient(supabaseUrlSewing, supabaseKeySewing);
const supabaseUpholstery = createClient(supabaseUrlUpholstery, supabaseKeyUpholstery);

console.log('✅ Sewing Supabase initialized');
console.log('✅ Upholstery Supabase initialized');

// ========== HELPER FUNCTIONS ==========

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
        postcodeDistrict: data.result.outward_code
      };
    }
  } catch (error) {
    console.warn('⚠️ Postcode lookup failed for:', postcode);
  }
  
  return null;
}

// Verify JWT Token Middleware
function verifyToken(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        return res.status(403).json({ error: 'Invalid or expired token' });
      }
      req.user = decoded;
      next();
    });
  } catch (error) {
    return res.status(500).json({ error: 'Token verification error' });
  }
}

// ========== HEALTH CHECK ==========
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'production'
  });
});

// ========== LOGIN ENDPOINTS ==========

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    console.log(`🔐 Login attempt for: ${email}`);

    // Try Sewing Supabase first
    let loginResult = await loginToDatabase(email, password, supabaseSewing, 'sewing');

    // If not found in sewing, try Upholstery
    if (!loginResult.success) {
      console.log(`📋 Not in Sewing, trying Upholstery...`);
      loginResult = await loginToDatabase(email, password, supabaseUpholstery, 'upholstery');
    }

    if (!loginResult.success) {
      console.log(`❌ Login failed for ${email}`);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Create JWT token
    const token = jwt.sign(
      {
        id: loginResult.candidateId,
        email: loginResult.email,
        accountType: loginResult.accountType,
        unifiedId: loginResult.unifiedId,
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log(`✅ Login successful for ${email} (${loginResult.accountType})`);

    return res.json({
      token,
      candidateId: loginResult.candidateId,
      email: loginResult.email,
      accountType: loginResult.accountType,
      unifiedId: loginResult.unifiedId,
    });
  } catch (error) {
    console.error('❌ Login error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

async function loginToDatabase(email, password, supabase, dbType) {
  try {
    const { data, error } = await supabase
      .from('unified_auth')
      .select('*')
      .eq('email', email)
      .eq('is_active', true)
      .single();

    if (error || !data) {
      return { success: false };
    }

    const passwordMatch = await bcryptjs.compare(password, data.password_hash);

    if (!passwordMatch) {
      console.log(`⚠️  Password mismatch for ${email}`);
      return { success: false };
    }

    let candidateId;
    if (dbType === 'sewing') {
      candidateId = data.sewing_candidate_id;
    } else {
      candidateId = data.upholstery_candidate_id;
    }

    await supabase
      .from('unified_auth')
      .update({ last_login: new Date().toISOString() })
      .eq('email', email);

    return {
      success: true,
      email: data.email,
      candidateId: candidateId,
      unifiedId: data.unified_id,
      accountType: data.account_type,
    };
  } catch (error) {
    console.error(`Error logging into ${dbType} database:`, error);
    return { success: false };
  }
}

// Get Profile (Protected Route)
app.get('/api/profile', verifyToken, async (req, res) => {
  try {
    const { accountType, unifiedId } = req.user;
    const supabase = accountType === 'sewing' ? supabaseSewing : supabaseUpholstery;

    const { data, error } = await supabase
      .from('unified_auth')
      .select('*')
      .eq('unified_id', unifiedId)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    return res.json({
      profile: {
        email: data.email,
        unifiedId: data.unified_id,
        accountType: data.account_type,
        lastLogin: data.last_login,
        isActive: data.is_active,
      },
    });
  } catch (error) {
    console.error('Profile fetch error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ========== SEWING CANDIDATES ==========

// Get all sewing candidates
app.get('/api/candidates', async (req, res) => {
  try {
    console.log('📋 Fetching sewing candidates...');
    
    const { data: publicData, error: publicError } = await supabaseSewing
      .from('candidates_public')
      .select('*')
      .order('created_at', { ascending: false });
    
    const { data: privateData } = await supabaseSewing
      .from('candidates_private')
      .select('candidate_id, postcode')
      .order('created_at', { ascending: false });

    if (publicError) {
      console.error('❌ Error:', publicError);
      return res.status(400).json({ error: publicError.message });
    }

    if (!publicData || publicData.length === 0) {
      return res.json([]);
    }

    const candidates = await Promise.all(publicData.map(async (c) => {
      const privateRecord = privateData?.find(p => p.candidate_id === c.candidate_id);
      
      let coordinates = null;
      let postcodeDistrict = null;
      
      if (privateRecord?.postcode) {
        const coords = await getCoordinatesFromPostcode(privateRecord.postcode);
        if (coords) {
          coordinates = { lat: coords.lat, lon: coords.lon };
          postcodeDistrict = coords.postcodeDistrict;
        }
      }
      
      return {
        id: c.id,
        candidateId: c.candidate_id,
        role: c.job_title,
        location: c.city,
        postcodeDistrict: postcodeDistrict,
        postcodeCoords: coordinates,
        yearsExperience: c.years_experience,
        availability: c.status || 'Unknown',
        sector: c.sector,
        workType: c.work_type,
        machines: c.machines ? c.machines.split(',').map(m => m.trim()).filter(m => m && m !== 'None selected') : [],
        products: c.products ? c.products.split(',').map(p => p.trim()).filter(p => p && p !== 'None selected') : [],
        materials: c.materials ? c.materials.split(',').map(m => m.trim()).filter(m => m && m !== 'None selected') : [],
        sewingTechniques: c.sewing_techniques ? c.sewing_techniques.split(',').map(t => t.trim()).filter(t => t && t !== 'None selected') : [],
        desiredSalary: c.desired_salary || 'Competitive',
        travelDistance: c.travel_distance,
        type: 'sewing'
      };
    }));

    console.log(`✅ Found ${candidates.length} sewing candidates`);
    res.json(candidates);

  } catch (error) {
    console.error('🔴 Error:', error);
    res.status(500).json({ error: 'Failed to fetch sewing candidates' });
  }
});

// Get single sewing candidate
app.get('/api/candidates/:id', async (req, res) => {
  try {
    console.log(`📋 Fetching sewing candidate: ${req.params.id}`);
    
    const { data: publicData, error: publicError } = await supabaseSewing
      .from('candidates_public')
      .select('*')
      .eq('candidate_id', req.params.id)
      .single();
    
    const { data: privateData } = await supabaseSewing
      .from('candidates_private')
      .select('candidate_id, postcode')
      .eq('candidate_id', req.params.id)
      .single();

    if (publicError) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    let coordinates = null;
    let postcodeDistrict = null;
    
    if (privateData?.postcode) {
      const coords = await getCoordinatesFromPostcode(privateData.postcode);
      if (coords) {
        coordinates = { lat: coords.lat, lon: coords.lon };
        postcodeDistrict = coords.postcodeDistrict;
      }
    }

    const candidate = {
      id: publicData.id,
      candidateId: publicData.candidate_id,
      role: publicData.job_title,
      location: publicData.city,
      postcodeDistrict: postcodeDistrict,
      postcodeCoords: coordinates,
      yearsExperience: publicData.years_experience,
      availability: publicData.status || 'Unknown',
      sector: publicData.sector,
      workType: publicData.work_type,
      machines: publicData.machines ? publicData.machines.split(',').map(m => m.trim()).filter(m => m && m !== 'None selected') : [],
      products: publicData.products ? publicData.products.split(',').map(p => p.trim()).filter(p => p && p !== 'None selected') : [],
      materials: publicData.materials ? publicData.materials.split(',').map(m => m.trim()).filter(m => m && m !== 'None selected') : [],
      sewingTechniques: publicData.sewing_techniques ? publicData.sewing_techniques.split(',').map(t => t.trim()).filter(t => t && t !== 'None selected') : [],
      desiredSalary: publicData.desired_salary || 'Competitive',
      travelDistance: publicData.travel_distance,
      type: 'sewing'
    };

    res.json(candidate);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to fetch candidate' });
  }
});

// ========== UPHOLSTERY CANDIDATES ==========

// Get all upholstery candidates
app.get('/api/upholstery', async (req, res) => {
  try {
    console.log('📋 Fetching upholstery candidates...');
    
    const { data: publicData, error: publicError } = await supabaseUpholstery
      .from('upholstery_public')
      .select('*')
      .order('created_at', { ascending: false });
    
    const { data: privateData } = await supabaseUpholstery
      .from('upholstery_private')
      .select('candidate_id, postcode')
      .order('created_at', { ascending: false });

    if (publicError) {
      console.error('❌ Error:', publicError);
      return res.status(400).json({ error: publicError.message });
    }

    if (!publicData || publicData.length === 0) {
      return res.json([]);
    }

    const candidates = await Promise.all(publicData.map(async (c) => {
      const privateRecord = privateData?.find(p => p.candidate_id === c.candidate_id);
      
      let coordinates = null;
      let postcodeDistrict = null;
      
      if (privateRecord?.postcode) {
        const coords = await getCoordinatesFromPostcode(privateRecord.postcode);
        if (coords) {
          coordinates = { lat: coords.lat, lon: coords.lon };
          postcodeDistrict = coords.postcodeDistrict;
        }
      }
      
      return {
        id: c.id,
        candidateId: c.candidate_id,
        role: c.job_title || 'Upholsterer',
        location: c.city || '',
        postcodeDistrict: postcodeDistrict,
        postcodeCoords: coordinates,
        yearsExperience: c.years_experience || 'Not specified',
        availability: c.status || 'Not specified',
        noticePeriod: c.availability || 'Not specified',
        sector: c.sector || 'Upholstery',
        workType: c.work_type || 'Not specified',
        travelDistance: c.travel_distance || 'Not specified',
        driversLicense: c.drivers_license || 'Not specified',
        ownVehicle: c.own_vehicle || 'Not specified',
        products: c.products ? (Array.isArray(c.products) ? c.products : c.products.split(',').map(s => s.trim())) : [],
        techniques: c.techniques ? (Array.isArray(c.techniques) ? c.techniques : c.techniques.split(',').map(s => s.trim())) : [],
        sewingMachineExperience: c.sewing_machine_experience || 'None',
        sewingMachines: c.sewing_machines_used ? c.sewing_machines_used.split(', ') : [],
        willingToRelocate: c.willing_to_relocate || 'Not specified',
        type: 'upholstery'
      };
    }));

    console.log(`✅ Found ${candidates.length} upholstery candidates`);
    res.json(candidates);

  } catch (error) {
    console.error('🔴 Error:', error);
    res.status(500).json({ error: 'Failed to fetch upholstery candidates' });
  }
});

// Get single upholstery candidate
app.get('/api/upholstery/:id', async (req, res) => {
  try {
    console.log(`📋 Fetching upholstery candidate: ${req.params.id}`);
    
    const { data: publicData, error: publicError } = await supabaseUpholstery
      .from('upholstery_public')
      .select('*')
      .eq('candidate_id', req.params.id)
      .single();
    
    const { data: privateData } = await supabaseUpholstery
      .from('upholstery_private')
      .select('candidate_id, postcode')
      .eq('candidate_id', req.params.id)
      .single();

    if (publicError) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    let coordinates = null;
    let postcodeDistrict = null;
    
    if (privateData?.postcode) {
      const coords = await getCoordinatesFromPostcode(privateData.postcode);
      if (coords) {
        coordinates = { lat: coords.lat, lon: coords.lon };
        postcodeDistrict = coords.postcodeDistrict;
      }
    }

    const candidate = {
      id: publicData.id,
      candidateId: publicData.candidate_id,
      role: publicData.job_title || 'Upholsterer',
      location: publicData.city || '',
      postcodeDistrict: postcodeDistrict,
      postcodeCoords: coordinates,
      yearsExperience: publicData.years_experience || 'Not specified',
      availability: publicData.status || 'Not specified',
      noticePeriod: publicData.availability || 'Not specified',
      sector: publicData.sector || 'Upholstery',
      workType: publicData.work_type || 'Not specified',
      travelDistance: publicData.travel_distance || 'Not specified',
      driversLicense: publicData.drivers_license || 'Not specified',
      ownVehicle: publicData.own_vehicle || 'Not specified',
      products: publicData.products ? (Array.isArray(publicData.products) ? publicData.products : publicData.products.split(',').map(s => s.trim())) : [],
      techniques: publicData.techniques ? (Array.isArray(publicData.techniques) ? publicData.techniques : publicData.techniques.split(',').map(s => s.trim())) : [],
      sewingMachineExperience: publicData.sewing_machine_experience || 'None',
      sewingMachines: publicData.sewing_machines_used ? publicData.sewing_machines_used.split(', ') : [],
      willingToRelocate: publicData.willing_to_relocate || 'Not specified',
      type: 'upholstery'
    };

    res.json(candidate);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to fetch candidate' });
  }
});

// ========== 404 HANDLER ==========
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not Found',
    availableRoutes: [
      'GET /health',
      'POST /api/login - Login with email/password',
      'GET /api/profile - Get profile (requires token)',
      'GET /api/candidates - All sewing candidates',
      'GET /api/candidates/:id - Single sewing candidate',
      'GET /api/upholstery - All upholstery candidates',
      'GET /api/upholstery/:id - Single upholstery candidate'
    ]
  });
});

// ========== ERROR HANDLER ==========
app.use((err, req, res, next) => {
  console.error('🔴 Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal Server Error',
    message: err.message
  });
});

export default app;
