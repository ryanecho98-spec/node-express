import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase keys');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/candidates', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('candidates_public')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

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
      desiredSalary: c.desired_salary || 'Competitive',
      travelDistance: c.travel_distance
    }));

    res.json(candidates);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch candidates' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
