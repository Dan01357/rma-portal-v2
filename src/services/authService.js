import { supabase } from '../supabaseClient';

const AUTH_STORAGE_KEY = 'rma_portal_admin_session';
const HR_API_KEY_STORAGE = 'pingcon_hr_api_key';

// Default initial company employee directory (Strictly Company Emails)
const DEFAULT_EMPLOYEES = [
  {
    name: 'Danilo Alvaro Jr. (Super Admin)',
    email: 'finance2@keysysincorporated.com',
    role: 'super_admin',
    is_active: true,
    department: 'Finance Systems / IT'
  },
  {
    name: 'Alleli F. Almaida',
    email: 'alleli.almaida@ph.keysys.com',
    role: 'admin',
    is_active: true,
    department: 'Finance'
  },
  {
    name: 'Analiza B. Benosa',
    email: 'finance@a2z2go.net',
    role: 'admin',
    is_active: true,
    department: 'Finance'
  },
  {
    name: 'Glencel O. Azogue',
    email: 'accountspayable@keysysincorporated.com',
    role: 'admin',
    is_active: true,
    department: 'Accounts Payable'
  },
  {
    name: 'Jarmen A. Cachero',
    email: 'finance4@keysysincorporated.com',
    role: 'admin',
    is_active: true,
    department: 'Finance Systems'
  },
  {
    name: 'Mark John A. Aquino',
    email: 'mark.aquino@a2z2go.net',
    role: 'admin',
    is_active: true,
    department: 'A2Z2GO Procurement'
  },
  {
    name: 'Ralph Raven A. Alido',
    email: 'ralph.alido@a2z2go.net',
    role: 'admin',
    is_active: true,
    department: 'A2Z2GO Operations'
  },
  {
    name: 'Mary T. Gan',
    email: 'mgan@pingconmarketing.com',
    role: 'admin',
    is_active: true,
    department: 'Executive Management'
  },
  {
    name: 'Aila Marie B. Bacsal',
    email: 'aila.bacsal@ph.keysys.com',
    role: 'inventory_staff',
    is_active: true,
    department: 'Warehouse'
  },
  {
    name: 'Daniel M. Alcantara',
    email: 'daniel.alcantara@pingcon.com',
    role: 'inventory_staff',
    is_active: true,
    department: 'Pingcon Sales'
  },
  {
    name: 'Jeffrey U. Amandy',
    email: 'jeffrey.amandy@ph.keysys.com',
    role: 'inventory_staff',
    is_active: true,
    department: 'Pingcon Operations'
  },
  {
    name: 'Karen Joy R. Amarille',
    email: 'karen.amarille@ph.keysys.com',
    role: 'inventory_staff',
    is_active: true,
    department: 'Pingcon Operations'
  },
  {
    name: 'Inna V. Amparo',
    email: 'inna.amparo@ph.keysys.com',
    role: 'inventory_staff',
    is_active: true,
    department: 'Pingcon Operations'
  },
  {
    name: 'Kimberly Joie F. Antazo',
    email: 'kimeberly.antazo@ph.keysys.com',
    role: 'inventory_staff',
    is_active: true,
    department: 'Pingcon Operations'
  },
  {
    name: 'Michael R. Arcangel',
    email: 'michael.arcangel@keysysincorporated.com',
    role: 'inventory_staff',
    is_active: true,
    department: 'Pingcon Operations'
  },
  {
    name: 'Gilbert S. Arevalo',
    email: 'gilbert.arevalo@ph.keysys.com',
    role: 'inventory_staff',
    is_active: true,
    department: 'Pingcon Operations'
  },
  {
    name: 'John Raymond A. Azuela',
    email: 'john.azuela@ph.keysys.com',
    role: 'inventory_staff',
    is_active: true,
    department: 'Pingcon Operations'
  },
  {
    name: 'James Christian A. Baldosa',
    email: 'james.baldosa@ph.keysys.com',
    role: 'inventory_staff',
    is_active: true,
    department: 'Pingcon Operations'
  },
  {
    name: 'Marifel M. Balonzo',
    email: 'marifel.mata@pingcon.com',
    role: 'inventory_staff',
    is_active: true,
    department: 'Pingcon Operations'
  },
  {
    name: 'Luisito Barnuevo',
    email: 'luisito.barnuevo@ph.keysys.com',
    role: 'inventory_staff',
    is_active: true,
    department: 'Pingcon Operations'
  },
  {
    name: 'Jade Martin Batula',
    email: 'jade.batula@ph.keysys.com',
    role: 'inventory_staff',
    is_active: true,
    department: 'Pingcon Operations'
  },
  {
    name: 'Bless P. Bautista',
    email: 'bless.bautista@pingcon.com',
    role: 'inventory_staff',
    is_active: true,
    department: 'Pingcon Operations'
  },
  {
    name: 'Grace C. Cabanela',
    email: 'grace.cabanela@ph.keysys.com',
    role: 'inventory_staff',
    is_active: true,
    department: 'Pingcon Operations'
  },
  {
    name: 'Mary Jane N. Cerezo',
    email: 'mary.cerezo@ph.keysys.com',
    role: 'inventory_staff',
    is_active: true,
    department: 'Pingcon Operations'
  },
  {
    name: 'Mario U. Cernias',
    email: 'mario.cernias@ph.keysys.com',
    role: 'inventory_staff',
    is_active: true,
    department: 'Pingcon Operations'
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
   * Strictly extracts COMPANY EMAILS from the HR system/sheet, ignoring personal accounts.
   * Endpoint: https://hr-center-pingcon.laravel.cloud/api/v1/employees
   */
  async syncFromHRCenter(apiKey) {
    const key = apiKey || this.getHrApiKey();
    if (!key) {
      throw new Error('HR Center API Key is required. Please obtain your key from the developer tools.');
    }

    try {
      const res = await fetch('https://hr-center-pingcon.laravel.cloud/api/v1/employees?per_page=150', {
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

      // Upsert into Supabase admin_users with COMPANY EMAIL PRIORITY
      const rows = [];
      for (const emp of hrList) {
        // Look for company email field
        const companyEmail = (
          emp.company_email ||
          emp.companyEmail ||
          emp.company_email_address ||
          emp.work_email ||
          emp.official_email ||
          emp.corporate_email ||
          ''
        ).toLowerCase().trim();

        let chosenEmail = companyEmail;

        // Fallback only if no designated company email, and ensure it is NOT a personal email
        if (!chosenEmail || chosenEmail === 'n/a') {
          const rawEmail = (emp.email || '').toLowerCase().trim();
          if (rawEmail && !rawEmail.includes('@gmail.com') && !rawEmail.includes('@yahoo.com') && !rawEmail.includes('@hotmail.com')) {
            chosenEmail = rawEmail;
          }
        }

        // If this is Danilo Alvaro, enforce finance2@keysysincorporated.com as Super Admin
        const empName = emp.full_name || emp.name || `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || 'Employee';
        const isDanilo = empName.toLowerCase().includes('danilo') && empName.toLowerCase().includes('alvaro');

        if (isDanilo) {
          chosenEmail = 'finance2@keysysincorporated.com';
        }

        if (!chosenEmail || chosenEmail === 'n/a') {
          continue; // Skip employees without a valid company email
        }

        rows.push({
          name: isDanilo ? 'Danilo Alvaro Jr. (Super Admin)' : empName,
          email: chosenEmail,
          role: isDanilo ? 'super_admin' : (emp.role || 'inventory_staff'),
          is_active: emp.status !== 'resigned' && emp.status !== 'inactive' && emp.is_active !== false,
          department: emp.department || emp.department_name || (isDanilo ? 'Finance Systems / IT' : 'General')
        });
      }

      // Upsert rows into Supabase admin_users
      for (const row of rows) {
        await supabase
          .from('admin_users')
          .upsert([row], { onConflict: 'email' });
      }

      this.setHrApiKey(key);
      return { 
        count: rows.length, 
        message: `Successfully synchronized ${rows.length} company employee accounts with official company emails!` 
      };
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
   * Super Admin action: Add new employee with company email
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
   * 1. Checks if email belongs to authorized company employee directory
   * 2. Checks if employee is ACTIVE (blocks resigned accounts)
   * 3. Generates OTP token in database for verification redundancy
   * 4. Dispatches genuine email via Supabase Auth signInWithOtp (using custom SMTP from finance2@keysysincorporated.com)
   */
  async requestOtp(email) {
    const cleanEmail = (email || '').toLowerCase().trim();
    if (!cleanEmail) throw new Error('Please enter your company email address.');

    // 1. Check employee directory in Supabase
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
      console.warn('Supabase employee lookup notice:', e);
    }

    // Fallback to initial company employees
    if (!employee) {
      employee = DEFAULT_EMPLOYEES.find(e => e.email.toLowerCase() === cleanEmail);
    }

    if (!employee) {
      throw new Error(`Access Blocked: "${cleanEmail}" is not recognized as an authorized company employee email. Please use your official company email address.`);
    }

    // 2. Check if employee is resigned
    if (employee.is_active === false) {
      throw new Error(`Access Blocked: This employee account (${cleanEmail}) is marked as RESIGNED or INACTIVE. Access denied.`);
    }

    // 3. Generate 6-digit OTP code for local/database fallback
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
      console.warn('OTP token insert notice:', e);
    }

    // Store in session cache
    sessionStorage.setItem(`otp_${cleanEmail}`, JSON.stringify({
      code: otpCode,
      expiresAt: Date.now() + 10 * 60 * 1000
    }));

    // 4. Trigger Real Supabase Auth Email Dispatch via Custom SMTP
    let emailDispatched = false;
    try {
      const { data, error } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: {
          shouldCreateUser: true
        }
      });
      if (!error) {
        emailDispatched = true;
        console.log(`[Supabase Auth] Real email OTP dispatched to ${cleanEmail}`);
      } else {
        console.warn('[Supabase Auth] signInWithOtp notice (Custom SMTP may still be pending configuration):', error.message);
      }
    } catch (e) {
      console.warn('[Supabase Auth] Dispatch error:', e);
    }

    return {
      success: true,
      email: cleanEmail,
      sender: 'finance2@keysysincorporated.com',
      employeeName: employee.name,
      role: employee.role,
      emailDispatched,
      message: `OTP sent to ${cleanEmail}. Valid for 10 minutes.`
    };
  },

  /**
   * VERIFY OTP & CREATE SESSION
   * Verifies against Supabase Auth, or database otp_tokens table
   */
  async verifyOtp(email, enteredCode) {
    const cleanEmail = (email || '').toLowerCase().trim();
    const cleanCode = (enteredCode || '').trim();

    if (!cleanCode) throw new Error('Please enter the 6-digit OTP code.');

    let isValid = false;

    // 1. Attempt verification with Supabase Auth OTP
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: cleanEmail,
        token: cleanCode,
        type: 'email'
      });
      if (!error && data?.session) {
        isValid = true;
      }
    } catch (e) {
      console.warn('Supabase Auth verify notice:', e);
    }

    // 2. Fallback: Check Supabase otp_tokens table
    if (!isValid) {
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
    }

    // 3. Fallback: Check session cache
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
        console.warn('Session OTP check notice:', e);
      }
    }

    if (!isValid) {
      throw new Error('Invalid or expired OTP code. Please check your inbox or request a new code.');
    }

    // 4. Fetch employee details from admin_users
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
