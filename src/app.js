// ========== src/app.js ==========
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();

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

// Verify Supabase Token Middleware
async function verifySupabaseToken(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      console.warn('⚠️ No token provided for protected route:', req.path);
      return res.status(401).json({ error: 'No token provided' });
    }

    // Verify token with Supabase (try both projects)
    let user = null;
    let supabaseClient = null;

    // Try Sewing first
    const { data: sewingUser, error: sewingError } = await supabaseSewing.auth.getUser(token);
    if (sewingUser?.user) {
      user = sewingUser.user;
      supabaseClient = supabaseSewing;
      console.log('✅ Token verified with Sewing Supabase');
    } else if (!sewingError) {
      // Try Upholstery
      const { data: upholsteryUser, error: upholsteryError } = await supabaseUpholstery.auth.getUser(token);
      if (upholsteryUser?.user) {
        user = upholsteryUser.user;
        supabaseClient = supabaseUpholstery;
        console.log('✅ Token verified with Upholstery Supabase');
      }
    }

    if (!user) {
      console.warn('⚠️ Invalid or expired token');
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    req.user = user;
    req.supabase = supabaseClient;
    next();
  } catch (error) {
    console.error('Token verification error:', error);
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

// ========== REGISTRATION ENDPOINT ==========
app.post('/api/register', async (req, res) => {
  try {
    const {
      email,
      password,
      confirmPassword,
      accountType,
      company,
      postcode,
      city,
      county,
      jobTitle,
      jobDescription,
      employmentType,
      salaryFrom,
      salaryTo,
      hoursPerWeek,
      benefits,
      experienceRequired,
      machines,
      techniques
    } = req.body;

    console.log(`📝 Registration attempt: ${email} (${accountType})`);

    // Validate input
    if (!email || !password || !accountType || !company) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    if (!['sewing', 'upholstery'].includes(accountType)) {
      return res.status(400).json({ error: 'Invalid account type' });
    }

    const supabase = accountType === 'sewing' ? supabaseSewing : supabaseUpholstery;

    // 1. Create user in Supabase Auth
    console.log(`🔐 Creating Supabase user for ${email}`);
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });

    if (authError) {
      console.error('❌ Auth error:', authError.message);
      return res.status(400).json({ error: authError.message });
    }

    console.log(`✅ User created: ${authData.user.id}`);

    // 2. Save client registration details to database
    console.log(`💾 Saving client registration to database`);
    const { data: regData, error: regError } = await supabase
      .from('client_registrations')
      .insert({
        email,
        company_name: company,
        postcode,
        city,
        county,
        job_title: jobTitle,
        job_description: jobDescription,
        employment_type: employmentType,
        salary_from: salaryFrom,
        salary_to: salaryTo,
        hours_per_week: hoursPerWeek,
        benefits,
        experience_required: experienceRequired,
        machines,
        techniques,
        account_type: accountType,
        created_at: new Date().toISOString()
      });

    if (regError) {
      console.error('⚠️ Registration details save error:', regError.message);
      // Don't fail - user was created in auth, registration details are optional
    }

    console.log(`✅ Registration complete for ${email}`);

    // Return success
    res.status(201).json({
      success: true,
      message: 'Registration successful. You can now login.',
      email,
      accountType,
      company
    });

  } catch (error) {
    console.error('❌ Registration error:', error.message);
    res.status(500).json({ error: 'Registration failed: ' + error.message });
  }
});

// ========== LOGIN ENDPOINTS ==========

// Login with email/password (using Supabase Auth)
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    console.log(`🔐 Login attempt for: ${email}`);

    // Try Sewing Supabase first
    let loginResult = await loginToSupabase(email, password, supabaseSewing, 'sewing');

    // If not found in sewing, try Upholstery
    if (!loginResult.success) {
      console.log(`📋 Not in Sewing, trying Upholstery...`);
      loginResult = await loginToSupabase(email, password, supabaseUpholstery, 'upholstery');
    }

    if (!loginResult.success) {
      console.log(`❌ Login failed for ${email}`);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    console.log(`✅ Login successful for ${email} (${loginResult.accountType})`);

    return res.json({
      token: loginResult.session.access_token,
      user: {
        id: loginResult.user.id,
        email: loginResult.user.email,
        accountType: loginResult.accountType,
      },
      expiresIn: loginResult.session.expires_in,
    });
  } catch (error) {
    console.error('❌ Login error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

async function loginToSupabase(email, password, supabase, dbType) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user) {
      console.log(`⚠️ Login failed for ${email} on ${dbType}`);
      return { success: false };
    }

    return {
      success: true,
      user: data.user,
      session: data.session,
      accountType: dbType,
    };
  } catch (error) {
    console.error(`Error logging into ${dbType} Supabase:`, error);
    return { success: false };
  }
}

// Get Profile (Protected Route)
app.get('/api/profile', verifySupabaseToken, async (req, res) => {
  try {
    const user = req.user;

    return res.json({
      profile: {
        id: user.id,
        email: user.email,
        createdAt: user.created_at,
      },
    });
  } catch (error) {
    console.error('Profile fetch error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ========== SEWING CANDIDATES ==========

// Get all sewing candidates (PUBLIC)
app.get('/api/candidates', async (req, res) => {
  try {
    console.log('📋 Fetching sewing candidates (PUBLIC endpoint)');
    
    const { data: publicData, error: publicError } = await supabaseSewing
      .from('candidates_public')
      .select('*')
      .order('created_at', { ascending: false });
    
    const { data: privateData } = await supabaseSewing
      .from('candidates_private')
      .select('candidate_id, postcode')
      .order('created_at', { ascending: false });

    if (publicError) {
      console.error('❌ Supabase Error:', publicError);
      return res.status(400).json({ error: publicError.message });
    }

    if (!Array.isArray(publicData) || publicData.length === 0) {
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

// Get single sewing candidate (PUBLIC)
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

// Get all upholstery candidates (PUBLIC)
app.get('/api/upholstery', async (req, res) => {
  try {
    console.log('📋 Fetching upholstery candidates (PUBLIC endpoint)');
    
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

    if (!Array.isArray(publicData) || publicData.length === 0) {
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

// Get single upholstery candidate (PUBLIC)
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
      'POST /api/register - Register new employer account',
      'POST /api/login - Login with email/password (returns Supabase token)',
      'GET /api/profile - Get profile (requires Supabase token)',
      'GET /api/candidates - All sewing candidates (public)',
      'GET /api/candidates/:id - Single sewing candidate (public)',
      'GET /api/upholstery - All upholstery candidates (public)',
      'GET /api/upholstery/:id - Single upholstery candidate (public)'
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
