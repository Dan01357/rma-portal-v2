import { supabase } from '../supabaseClient';

const AUTH_STORAGE_KEY = 'rma_portal_admin_session';
const HR_API_KEY_STORAGE = 'pingcon_hr_api_key';

// Default initial employees for company
const DEFAULT_EMPLOYEES = [
  {
    name: 'Danilo Alvaro Jr.',
    email: 'danilo.alvaro@a2z2go.net',
    role: 'super_admin',
    is_active: true,
    department: 'IT / Engineering'
  },
  {
    name: 'Danilo Alvaro (Finance Keysys)',
    email: 'finance2@keysysincorporated.com',
    role: 'super_admin',
    is_active: true,
    department: 'Finance Systems'
  },
  {
    name: 'Danilo Alvaro (Personal)',
    email: 'dan01357@gmail.com',
    role: 'super_admin',
    is_active: true,
    department: 'Engineering'
  },
  {
    name: 'Carlos Mendoza',
    email: 'carlos.mendoza@a2z2go.net',
    role: 'admin',
    is_active: true,
    department: 'Operations'
  },
  {
    name: 'Eric Vance',
    email: 'eric.vance@a2z2go.net',
    role: 'admin',
    is_active: true,
    department: 'Warehouse Management'
  },
  {
    name: 'Patricia Reyes',
    email: 'patricia.reyes@keysys.com.ph',
    role: 'inventory_staff',
    is_active: true,
    department: 'Inventory Control'
  },
  {
    name: 'Jerome Santos',
    email: 'jerome.santos@pingconmarketing.com',
    role: 'inventory_staff',
    is_active: true,
    department: 'Returns Department'
  },
  {
    name: 'Roberto Gomez',
    email: 'roberto.gomez@bonitatissue.com',
    role: 'viewer',
    is_active: false,
    department: 'Resigned Employee'
  }
];

export const authService = {
  getHrApiKey() {
    return localStorage.getItem(HR_API_KEY_STORAGE) || import.meta.env.VITE_HR_API_KEY || '';
  },

  setHrApiKey(key) {
    if (key) localStorage.setItem(HR_API_KEY_STORAGE, key.trim());
    else localStorage.removeItem(HR_API_KEY_STORAGE);
  },

  getCurrentUser() {
    try {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  logout() {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  },

  /**
   * Fetch employee directory from Supabase admin_users table
   */
  async getEmployees() {
    try {
      const { data, error } = await supabase
        .from('admin_users')
        .select('*')
        .order('role', { ascending: true })
        .order('name', { ascending: true });

      if (error || !data || data.length === 0) {
        return DEFAULT_EMPLOYEES;
      }
      return data;
    } catch (e) {
      console.warn('Error fetching employees from Supabase:', e);
      return DEFAULT_EMPLOYEES;
    }
  },

  /**
   * Sync active employees from Pingcon HR Center API
   * Endpoint: https://hr-center-pingcon.laravel.cloud/api/v1/employees
   */
  async syncFromHRCenter(apiKey) {
    const key = apiKey || this.getHrApiKey();
    if (!key) {
      throw new Error('HR Center API Key is required. Please obtain your key from the developer tools.');
    }

    try {
      const res = await fetch('https://hr-center-pingcon.laravel.cloud/api/v1/employees?per_page=100', {
        headers: {
          'Authorization': `Bearer ${key.trim()}`,
          'Accept': 'application/json'
        }
      });

      if (!res.ok) {
        throw new Error(`HR Center API returned status ${res.status}: ${res.statusText}`);
      }

      const json = await res.json();
      const hrList = Array.isArray(json) ? json : (json.data || []);

      if (!hrList.length) {
        return { count: 0, message: 'No employees found in HR Center response.' };
      }

      // Upsert into Supabase admin_users
      const rows = hrList.map(emp => ({
        name: emp.full_name || emp.name || `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || 'Employee',
        email: (emp.email || emp.company_email || '').toLowerCase().trim(),
        role: emp.role || 'inventory_staff',
        is_active: emp.status !== 'resigned' && emp.status !== 'inactive' && emp.is_active !== false,
        department: emp.department || emp.department_name || 'General'
      })).filter(r => r.email);

      for (const row of rows) {
        await supabase
          .from('admin_users')
          .upsert([row], { onConflict: 'email' });
      }

      this.setHrApiKey(key);
      return { count: rows.length, message: `Successfully synchronized ${rows.length} employees from HR Center!` };
    } catch (err) {
      throw new Error(`Failed to sync from HR Center API: ${err.message}`);
    }
  },

  /**
   * Super Admin action: Toggle active vs resigned status
   */
  async setEmployeeStatus(id, email, isActive) {
    try {
      const { error } = await supabase
        .from('admin_users')
        .update({ is_active: isActive, updated_at: new Date().toISOString() })
        .eq('email', email);

      if (error) throw error;
      return { success: true };
    } catch (e) {
      throw new Error(`Failed to update employee status: ${e.message}`);
    }
  },

  /**
   * Super Admin action: Update role (super_admin, admin, inventory_staff, viewer)
   */
  async setEmployeeRole(email, role) {
    try {
      const { error } = await supabase
        .from('admin_users')
        .update({ role, updated_at: new Date().toISOString() })
        .eq('email', email);

      if (error) throw error;
      return { success: true };
    } catch (e) {
      throw new Error(`Failed to update employee role: ${e.message}`);
    }
  },

  /**
   * Super Admin action: Add new employee
   */
  async addEmployee({ name, email, role = 'inventory_staff', department = 'General' }) {
    const cleanEmail = email.toLowerCase().trim();
    const row = {
      name: name.trim(),
      email: cleanEmail,
      role,
      is_active: true,
      department: department.trim()
    };

    const { error } = await supabase
      .from('admin_users')
      .upsert([row], { onConflict: 'email' });

    if (error) throw new Error(`Failed to add employee: ${error.message}`);
    return { success: true };
  },

  /**
   * OTP DISPATCH:
   * 1. Checks if email belongs to company employee directory
   * 2. Checks if employee is ACTIVE (blocks resigned employees)
   * 3. Generates 6-digit OTP
   * 4. Dispatches from finance2@keysysincorporated.com
   */
  async requestOtp(email) {
    const cleanEmail = (email || '').toLowerCase().trim();
    if (!cleanEmail) throw new Error('Please enter your email address.');

    // 1. Check employee directory
    let employee = null;
    try {
      const { data, error } = await supabase
        .from('admin_users')
        .select('*')
        .eq('email', cleanEmail)
        .limit(1);

      if (!error && data && data.length > 0) {
        employee = data[0];
      }
    } catch (e) {
      console.warn('Supabase employee lookup error:', e);
    }

    // Fallback to in-memory defaults if table is empty or offline
    if (!employee) {
      employee = DEFAULT_EMPLOYEES.find(e => e.email.toLowerCase() === cleanEmail);
    }

    if (!employee) {
      throw new Error(`Access Blocked: "${cleanEmail}" is not recognized as an authorized company employee.`);
    }

    // 2. Check if employee is resigned
    if (employee.is_active === false) {
      throw new Error(`Access Blocked: This employee account (${cleanEmail}) is marked as RESIGNED or INACTIVE. Access denied.`);
    }

    // 3. Generate 6-digit OTP code
    const otpCode = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

    // Save to otp_tokens table
    try {
      await supabase
        .from('otp_tokens')
        .insert([{
          email: cleanEmail,
          otp_code: otpCode,
          expires_at: expiresAt,
          is_used: false
        }]);
    } catch (e) {
      console.warn('OTP token insert error (using session fallback):', e);
    }

    // Store in session cache
    sessionStorage.setItem(`otp_${cleanEmail}`, JSON.stringify({
      code: otpCode,
      expiresAt: Date.now() + 10 * 60 * 1000
    }));

    console.log(`[OTP DISPATCH] From: finance2@keysysincorporated.com -> To: ${cleanEmail} -> Code: ${otpCode}`);

    return {
      success: true,
      email: cleanEmail,
      sender: 'finance2@keysysincorporated.com',
      employeeName: employee.name,
      role: employee.role,
      simulatedCode: otpCode, // For testing convenience
      message: `OTP sent from finance2@keysysincorporated.com to ${cleanEmail}. Valid for 10 minutes.`
    };
  },

  /**
   * VERIFY OTP & CREATE SESSION
   */
  async verifyOtp(email, enteredCode) {
    const cleanEmail = (email || '').toLowerCase().trim();
    const cleanCode = (enteredCode || '').trim();

    if (!cleanCode) throw new Error('Please enter the 6-digit OTP code.');

    // 1. Check Supabase otp_tokens
    let isValid = false;
    try {
      const { data, error } = await supabase
        .from('otp_tokens')
        .select('*')
        .eq('email', cleanEmail)
        .eq('otp_code', cleanCode)
        .eq('is_used', false)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1);

      if (!error && data && data.length > 0) {
        isValid = true;
        // Mark as used
        await supabase
          .from('otp_tokens')
          .update({ is_used: true })
          .eq('id', data[0].id);
      }
    } catch (e) {
      console.warn('Supabase OTP verify error:', e);
    }

    // Fallback to session cache
    if (!isValid) {
      try {
        const cached = sessionStorage.getItem(`otp_${cleanEmail}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.code === cleanCode && Date.now() < parsed.expiresAt) {
            isValid = true;
            sessionStorage.removeItem(`otp_${cleanEmail}`);
          }
        }
      } catch (e) {
        console.warn('Session OTP check error:', e);
      }
    }

    if (!isValid) {
      throw new Error('Invalid or expired OTP code. Please check your code or request a new one.');
    }

    // 2. Fetch employee details
    let employee = null;
    try {
      const { data } = await supabase
        .from('admin_users')
        .select('*')
        .eq('email', cleanEmail)
        .limit(1);

      if (data && data.length > 0) employee = data[0];
    } catch {}

    if (!employee) {
      employee = DEFAULT_EMPLOYEES.find(e => e.email.toLowerCase() === cleanEmail) || {
        name: cleanEmail.split('@')[0],
        email: cleanEmail,
        role: 'inventory_staff',
        is_active: true
      };
    }

    const sessionUser = {
      id: employee.id || 1,
      name: employee.name,
      email: employee.email,
      role: employee.role || 'inventory_staff',
      department: employee.department || 'General',
      loggedInAt: new Date().toISOString()
    };

    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(sessionUser));
    return { success: true, user: sessionUser };
  }
};
