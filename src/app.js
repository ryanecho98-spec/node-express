// ========== src/app.js (COMPLETE VERSION) ==========
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcryptjs from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();

// ========== MIDDLEWARE ==========
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// ========== SUPABASE CLIENTS ==========
// Sewing Supabase Client
const sewingSupabase = createClient(
  process.env.SUPABASE_URL_SEWING,
  process.env.SUPABASE_SERVICE_ROLE_KEY_SEWING
);

// Upholstery Supabase Client
const upholsterySupabase = createClient(
  process.env.SUPABASE_URL_UPHOLSTERY,
  process.env.SUPABASE_SERVICE_ROLE_KEY_UPHOLSTERY
);

// ========== JWT MIDDLEWARE ==========
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // "Bearer TOKEN"

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// ========== HEALTH CHECK ==========
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    sewing_connected: !!sewingSupabase,
    upholstery_connected: !!upholsterySupabase
  });
});

// ========== AUTHENTICATION ROUTES ==========
// POST /api/login - Login with email/password
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    console.log(`🔐 Login attempt for: ${email}`);

    // Try to find user in Sewing Supabase first
    const { data: sewingUser, error: sewingError } = await sewingSupabase
      .from('unified_auth')
      .select('*')
      .eq('email', email.toLowerCase())
      .eq('is_active', true)
      .single();

    let user = sewingUser;
    let accountType = 'sewing';

    // If not found in Sewing, try Upholstery
    if (sewingError || !sewingUser) {
      console.log('📋 Not in Sewing, trying Upholstery...');
      
      const { data: upholsteryUser, error: upholsteryError } = await upholsterySupabase
        .from('unified_auth')
        .select('*')
        .eq('email', email.toLowerCase())
        .eq('is_active', true)
        .single();

      if (upholsteryError || !upholsteryUser) {
        console.log(`❌ Login failed for ${email}`);
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      user = upholsteryUser;
      accountType = 'upholstery';
    }

    // Verify password
    const isPasswordValid = await bcryptjs.compare(password, user.password_hash);

    if (!isPasswordValid) {
      console.log(`⚠️  Password mismatch for ${email}`);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Update last login
    const supabase = accountType === 'sewing' ? sewingSupabase : upholsterySupabase;
    await supabase
      .from('unified_auth')
      .update({ 
        last_login: new Date().toISOString(),
        login_attempts: 0 
      })
      .eq('id', user.id);

    // Generate JWT token
    const token = jwt.sign(
      {
        unified_id: user.unified_id,
        email: user.email,
        account_type: accountType
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log(`✅ Login successful for ${email} (${accountType})`);

    res.json({
      token,
      user: {
        unified_id: user.unified_id,
        email: user.email,
        account_type: accountType
      },
      message: 'Login successful'
    });
  } catch (error) {
    console.error('❌ Login error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ========== PROTECTED ROUTES ==========
// GET /api/profile - Get authenticated user's profile
app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    const { unified_id, email, account_type } = req.user;

    // Fetch full profile from appropriate Supabase
    let profile = null;
    
    if (account_type === 'sewing' || account_type === 'both') {
      const { data, error } = await sewingSupabase
        .from('candidates_private')
        .select('*')
        .eq('email', email)
        .single();
      
      if (data && !error) profile = { ...data, account_type: 'sewing' };
    }
    
    if (!profile && (account_type === 'upholstery' || account_type === 'both')) {
      const { data, error } = await upholsterySupabase
        .from('upholstery_private')
        .select('*')
        .eq('email', email)
        .single();
      
      if (data && !error) profile = { ...data, account_type: 'upholstery' };
    }

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.json({
      unified_id,
      email,
      account_type,
      profile,
      message: 'Profile retrieved successfully'
    });
  } catch (error) {
    console.error('❌ Profile error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ========== CANDIDATES ENDPOINTS ==========
// GET /api/candidates - Get all sewing candidates (for logged-in users)
app.get('/api/candidates', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await sewingSupabase
      .from('candidates_private')
      .select('*')
      .eq('profile_status', 'Active')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Sewing candidates fetch error:', error);
      return res.status(500).json({ error: 'Failed to fetch candidates' });
    }

    console.log(`✅ Fetched ${data.length} sewing candidates`);
    res.json(data);
  } catch (error) {
    console.error('❌ Candidates error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/candidates/:id - Get single sewing candidate
app.get('/api/candidates/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await sewingSupabase
      .from('candidates_private')
      .select('*')
      .eq('candidate_id', id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    res.json(data);
  } catch (error) {
    console.error('❌ Candidate fetch error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/upholstery - Get all upholstery candidates (for logged-in users)
app.get('/api/upholstery', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await upholsterySupabase
      .from('upholstery_private')
      .select('*')
      .eq('profile_status', 'Active')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Upholstery candidates fetch error:', error);
      return res.status(500).json({ error: 'Failed to fetch candidates' });
    }

    console.log(`✅ Fetched ${data.length} upholstery candidates`);
    res.json(data);
  } catch (error) {
    console.error('❌ Upholstery candidates error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/upholstery/:id - Get single upholstery candidate
app.get('/api/upholstery/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await upholsterySupabase
      .from('upholstery_private')
      .select('*')
      .eq('candidate_id', id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Upholstery candidate not found' });
    }

    res.json(data);
  } catch (error) {
    console.error('❌ Upholstery candidate fetch error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ========== PROFILE UPDATE ROUTES ==========
// PUT /api/profile/update - Update candidate profile
app.put('/api/profile/update', authenticateToken, async (req, res) => {
  try {
    const { email, account_type } = req.user;
    const updates = req.body;

    // Remove fields that shouldn't be updated via this endpoint
    delete updates.id;
    delete updates.email;
    delete updates.candidate_id;
    delete updates.created_at;

    const supabase = account_type === 'sewing' ? sewingSupabase : upholsterySupabase;
    const tableName = account_type === 'sewing' ? 'candidates_private' : 'upholstery_private';

    const { data, error } = await supabase
      .from(tableName)
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('email', email)
      .select()
      .single();

    if (error) {
      console.error('❌ Profile update error:', error);
      return res.status(500).json({ error: 'Failed to update profile' });
    }

    console.log(`✅ Profile updated for ${email}`);
    res.json({
      message: 'Profile updated successfully',
      profile: data
    });
  } catch (error) {
    console.error('❌ Profile update error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/profile/change-password - Change password
app.put('/api/profile/change-password', authenticateToken, async (req, res) => {
  try {
    const { email, account_type } = req.user;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }

    const supabase = account_type === 'sewing' ? sewingSupabase : upholsterySupabase;

    // Get current password hash
    const { data: user, error: fetchError } = await supabase
      .from('unified_auth')
      .select('password_hash')
      .eq('email', email)
      .single();

    if (fetchError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    const isPasswordValid = await bcryptjs.compare(currentPassword, user.password_hash);

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const newPasswordHash = await bcryptjs.hash(newPassword, 10);

    // Update password
    const { error: updateError } = await supabase
      .from('unified_auth')
      .update({ 
        password_hash: newPasswordHash,
        updated_at: new Date().toISOString()
      })
      .eq('email', email);

    if (updateError) {
      console.error('❌ Password update error:', updateError);
      return res.status(500).json({ error: 'Failed to update password' });
    }

    console.log(`✅ Password changed for ${email}`);
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('❌ Password change error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ========== 404 HANDLER ==========
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

export default app;
