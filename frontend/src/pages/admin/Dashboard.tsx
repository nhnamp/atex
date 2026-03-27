import React, { useEffect, useState } from 'react';
import {
  Users, UserPlus, Plus, Trash2, Pencil, X,
  ChevronDown, ChevronRight, Upload, FileSpreadsheet,
  Building2, GraduationCap, Check, AlertTriangle, RefreshCw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import LoadingSpinner from '../../components/LoadingSpinner';
import api from '../../api';

// ── Types ─────────────────────────────────────────────
interface UserItem {
  id: number; username: string; fullName: string; role: string;
  status: string; createdAt?: string; departmentId?: number | null; studentClassId?: number | null;
}
interface Department { id: number; name: string; _count: { teachers: number }; }
interface StudentClassItem { id: number; name: string; _count: { students: number }; }
interface ImportResult { message: string; created: string[]; alreadyExists: string[]; invalid: string[]; }

// ── Main Component ────────────────────────────────────
const AdminDashboard: React.FC = () => {
  const [tab, setTab] = useState<'students' | 'teachers'>('students');
  const [allUsers, setAllUsers] = useState<UserItem[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [studentClasses, setStudentClasses] = useState<StudentClassItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Expanded groups
  const [expandedClass, setExpandedClass] = useState<number | null>(null);
  const [expandedDept, setExpandedDept] = useState<number | null>(null);

  // Modals
  const [modal, setModal] = useState<string | null>(null);
  const [editItem, setEditItem] = useState<any>(null);
  const [form, setForm] = useState<any>({});

  // Multi-select
  const [selectedUsers, setSelectedUsers] = useState<Set<number>>(new Set());

  // Excel
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [usersRes, deptRes, clsRes] = await Promise.all([
        api.get<UserItem[]>('/admin/users'),
        api.get<Department[]>('/admin/departments'),
        api.get<StudentClassItem[]>('/admin/student-classes'),
      ]);
      setAllUsers(usersRes.data);
      setDepartments(deptRes.data);
      setStudentClasses(clsRes.data);
      setSelectedUsers(new Set());
    } catch { toast.error('Failed to load data'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const teachers = allUsers.filter(u => u.role === 'TEACHER');
  const students = allUsers.filter(u => u.role === 'STUDENT');

  // ── Selection helpers ─────────────────────────────────
  const toggleSelect = (id: number) => {
    setSelectedUsers(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllInGroup = (userList: UserItem[]) => {
    setSelectedUsers(prev => {
      const next = new Set(prev);
      const allSelected = userList.every(u => next.has(u.id));
      if (allSelected) {
        userList.forEach(u => next.delete(u.id));
      } else {
        userList.forEach(u => next.add(u.id));
      }
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (selectedUsers.size === 0) return;
    if (!confirm(`Delete ${selectedUsers.size} selected user(s)? This cannot be undone.`)) return;
    try {
      const { data } = await api.post('/admin/users/bulk-delete', { userIds: Array.from(selectedUsers) });
      toast.success(data.message);
      fetchData();
    } catch { toast.error('Failed to delete'); }
  };

  // ── Single action handlers ────────────────────────────
  const handleDeleteUser = async (id: number, name: string) => {
    if (!confirm(`Delete user "${name}"? This cannot be undone.`)) return;
    try { await api.delete(`/admin/users/${id}`); toast.success('Deleted'); fetchData(); }
    catch { toast.error('Failed to delete'); }
  };

  const openEditUser = (u: UserItem) => {
    setEditItem(u);
    setForm({
      fullName: u.fullName,
      departmentId: u.departmentId ?? '',
      studentClassId: u.studentClassId ?? '',
    });
    setModal('editUser');
  };

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.put(`/admin/users/${editItem.id}`, form);
      toast.success('Updated'); setModal(null); fetchData();
    } catch { toast.error('Failed to update'); }
  };

  // Department CRUD
  const handleCreateDept = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.post('/admin/departments', { name: form.name }); toast.success('Created'); setModal(null); fetchData(); }
    catch (err: any) { toast.error(err?.response?.data?.error || 'Failed'); }
  };
  const handleEditDept = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.put(`/admin/departments/${editItem.id}`, { name: form.name }); toast.success('Updated'); setModal(null); fetchData(); }
    catch { toast.error('Failed'); }
  };
  const handleDeleteDept = async (id: number, name: string) => {
    if (!confirm(`Delete department "${name}"?`)) return;
    try { await api.delete(`/admin/departments/${id}`); toast.success('Deleted'); fetchData(); }
    catch { toast.error('Failed'); }
  };

  // StudentClass CRUD
  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.post('/admin/student-classes', { name: form.name }); toast.success('Created'); setModal(null); fetchData(); }
    catch (err: any) { toast.error(err?.response?.data?.error || 'Failed'); }
  };
  const handleEditClass = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.put(`/admin/student-classes/${editItem.id}`, { name: form.name }); toast.success('Updated'); setModal(null); fetchData(); }
    catch { toast.error('Failed'); }
  };
  const handleDeleteClass = async (id: number, name: string) => {
    if (!confirm(`Delete class "${name}"?`)) return;
    try { await api.delete(`/admin/student-classes/${id}`); toast.success('Deleted'); fetchData(); }
    catch { toast.error('Failed'); }
  };

  // Create student / teacher
  const handleCreateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/admin/students', form);
      toast.success('Student created'); setModal(null); fetchData();
    } catch (err: any) { toast.error(err?.response?.data?.error || 'Failed'); }
  };
  const handleCreateTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/admin/teachers', form);
      toast.success('Teacher created'); setModal(null); fetchData();
    } catch (err: any) { toast.error(err?.response?.data?.error || 'Failed'); }
  };

  // Excel import
  const handleExcelUpload = async () => {
    if (!file) return;
    setUploading(true); setImportResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (form.studentClassId) fd.append('studentClassId', String(form.studentClassId));
      const { data } = await api.post<ImportResult>('/admin/students/import', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImportResult(data); toast.success(data.message); setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      fetchData();
    } catch (err: any) { toast.error(err?.response?.data?.error || 'Failed'); }
    finally { setUploading(false); }
  };

  // ── Render helpers ────────────────────────────────────
  const UserRow: React.FC<{ u: UserItem; color: string }> = ({ u, color }) => (
    <div className="flex items-center justify-between px-5 py-3 hover:bg-gray-50">
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={selectedUsers.has(u.id)}
          onChange={() => toggleSelect(u.id)}
          className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
        />
        <div className={`w-8 h-8 rounded-full bg-${color}-100 flex items-center justify-center text-${color}-600 font-bold text-xs`}>
          {u.fullName.charAt(0)}
        </div>
        <div>
          <p className="text-sm font-medium text-gray-900">{u.fullName}</p>
          <p className="text-xs text-gray-500">{u.username}</p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button onClick={() => openEditUser(u)} className="p-1.5 text-gray-400 hover:text-blue-500"><Pencil size={14} /></button>
        <button onClick={() => handleDeleteUser(u.id, u.fullName)} className="p-1.5 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
      </div>
    </div>
  );

  // ── Main render ───────────────────────────────────────
  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
            <p className="text-gray-500 mt-1">Manage students, teachers, and organizational structure</p>
          </div>
          <button onClick={fetchData} className="btn-secondary flex items-center gap-2">
            <RefreshCw size={16} /> Refresh
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { icon: Users, color: 'blue', label: 'Teachers', value: teachers.length },
            { icon: GraduationCap, color: 'green', label: 'Students', value: students.length },
            { icon: Building2, color: 'purple', label: 'Departments', value: departments.length },
          ].map((s) => (
            <div key={s.label} className="card p-5">
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-lg bg-${s.color}-100 flex items-center justify-center`}>
                  <s.icon size={20} className={`text-${s.color}-600`} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">{s.value}</p>
                  <p className="text-sm text-gray-500">{s.label}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="flex gap-6">
            {[
              { id: 'students', label: `Students (${students.length})` },
              { id: 'teachers', label: `Teachers (${teachers.length})` },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => { setTab(t.id as any); setSelectedUsers(new Set()); }}
                className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                  tab === t.id ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Bulk delete bar */}
        {selectedUsers.size > 0 && (
          <div className="flex items-center gap-3 bg-red-50 px-4 py-3 rounded-lg border border-red-200">
            <span className="text-sm font-medium text-red-700">{selectedUsers.size} selected</span>
            <button onClick={handleBulkDelete} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-600 text-white hover:bg-red-700 rounded-lg">
              <Trash2 size={14} /> Delete Selected
            </button>
            <button onClick={() => setSelectedUsers(new Set())} className="text-xs text-red-600 hover:text-red-800 ml-auto">Clear selection</button>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
        ) : (
          <>
            {/* ── Students Tab ────────────────────────── */}
            {tab === 'students' && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <button onClick={() => { setForm({ name: '' }); setModal('createClass'); }} className="btn-secondary flex items-center gap-2 text-sm">
                    <Plus size={14} /> New Class
                  </button>
                  <button onClick={() => { setForm({ username: '', fullName: '', password: '', studentClassId: '' }); setModal('createStudent'); }} className="btn-primary flex items-center gap-2 text-sm">
                    <UserPlus size={14} /> Add Student
                  </button>
                  <button onClick={() => { setForm({ studentClassId: '' }); setFile(null); setImportResult(null); setModal('importStudents'); }} className="btn-secondary flex items-center gap-2 text-sm">
                    <FileSpreadsheet size={14} /> Import Excel
                  </button>
                </div>

                {studentClasses.map((cls) => {
                  const clsStudents = students.filter(s => s.studentClassId === cls.id);
                  const isOpen = expandedClass === cls.id;
                  return (
                    <div key={cls.id} className="card overflow-hidden">
                      <div
                        className="flex items-center justify-between px-5 py-3 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
                        onClick={() => setExpandedClass(isOpen ? null : cls.id)}
                      >
                        <div className="flex items-center gap-3">
                          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          <span className="font-semibold text-gray-900">{cls.name}</span>
                          <span className="text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full">{clsStudents.length} students</span>
                        </div>
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          {isOpen && clsStudents.length > 0 && (
                            <button onClick={() => selectAllInGroup(clsStudents)} className="text-xs text-primary-600 hover:text-primary-800 mr-2">
                              Select all
                            </button>
                          )}
                          <button onClick={() => { setEditItem(cls); setForm({ name: cls.name }); setModal('editClass'); }} className="p-1.5 text-gray-400 hover:text-blue-500">
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => handleDeleteClass(cls.id, cls.name)} className="p-1.5 text-gray-400 hover:text-red-500">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      {isOpen && (
                        <div className="divide-y divide-gray-100">
                          {clsStudents.length === 0 ? (
                            <p className="px-5 py-4 text-sm text-gray-400">No students in this class</p>
                          ) : clsStudents.map((s) => (
                            <UserRow key={s.id} u={s} color="green" />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Unassigned students */}
                {(() => {
                  const unassigned = students.filter(s => !s.studentClassId);
                  if (unassigned.length === 0) return null;
                  const isOpen = expandedClass === -1;
                  return (
                    <div className="card overflow-hidden">
                      <div className="flex items-center justify-between px-5 py-3 bg-amber-50 cursor-pointer hover:bg-amber-100 transition-colors"
                        onClick={() => setExpandedClass(isOpen ? null : -1)}>
                        <div className="flex items-center gap-3">
                          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          <span className="font-semibold text-amber-800">Unassigned</span>
                          <span className="text-xs text-amber-600 bg-amber-200 px-2 py-0.5 rounded-full">{unassigned.length} students</span>
                        </div>
                        {isOpen && unassigned.length > 0 && (
                          <button onClick={e => { e.stopPropagation(); selectAllInGroup(unassigned); }} className="text-xs text-primary-600 hover:text-primary-800">
                            Select all
                          </button>
                        )}
                      </div>
                      {isOpen && (
                        <div className="divide-y divide-gray-100">
                          {unassigned.map((s) => <UserRow key={s.id} u={s} color="gray" />)}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ── Teachers Tab ────────────────────────── */}
            {tab === 'teachers' && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <button onClick={() => { setForm({ name: '' }); setModal('createDept'); }} className="btn-secondary flex items-center gap-2 text-sm">
                    <Plus size={14} /> New Department
                  </button>
                  <button onClick={() => { setForm({ username: '', fullName: '', password: '', departmentId: '' }); setModal('createTeacher'); }} className="btn-primary flex items-center gap-2 text-sm">
                    <UserPlus size={14} /> Add Teacher
                  </button>
                </div>

                {departments.map((dept) => {
                  const deptTeachers = teachers.filter(t => t.departmentId === dept.id);
                  const isOpen = expandedDept === dept.id;
                  return (
                    <div key={dept.id} className="card overflow-hidden">
                      <div
                        className="flex items-center justify-between px-5 py-3 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
                        onClick={() => setExpandedDept(isOpen ? null : dept.id)}
                      >
                        <div className="flex items-center gap-3">
                          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          <Building2 size={16} className="text-blue-500" />
                          <span className="font-semibold text-gray-900">{dept.name}</span>
                          <span className="text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full">{deptTeachers.length} teachers</span>
                        </div>
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          {isOpen && deptTeachers.length > 0 && (
                            <button onClick={() => selectAllInGroup(deptTeachers)} className="text-xs text-primary-600 hover:text-primary-800 mr-2">
                              Select all
                            </button>
                          )}
                          <button onClick={() => { setEditItem(dept); setForm({ name: dept.name }); setModal('editDept'); }} className="p-1.5 text-gray-400 hover:text-blue-500">
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => handleDeleteDept(dept.id, dept.name)} className="p-1.5 text-gray-400 hover:text-red-500">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      {isOpen && (
                        <div className="divide-y divide-gray-100">
                          {deptTeachers.length === 0 ? (
                            <p className="px-5 py-4 text-sm text-gray-400">No teachers in this department</p>
                          ) : deptTeachers.map((t) => (
                            <UserRow key={t.id} u={t} color="blue" />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Unassigned teachers */}
                {(() => {
                  const unassigned = teachers.filter(t => !t.departmentId);
                  if (unassigned.length === 0) return null;
                  const isOpen = expandedDept === -1;
                  return (
                    <div className="card overflow-hidden">
                      <div className="flex items-center justify-between px-5 py-3 bg-amber-50 cursor-pointer hover:bg-amber-100 transition-colors"
                        onClick={() => setExpandedDept(isOpen ? null : -1)}>
                        <div className="flex items-center gap-3">
                          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          <span className="font-semibold text-amber-800">Unassigned</span>
                          <span className="text-xs text-amber-600 bg-amber-200 px-2 py-0.5 rounded-full">{unassigned.length} teachers</span>
                        </div>
                        {isOpen && unassigned.length > 0 && (
                          <button onClick={e => { e.stopPropagation(); selectAllInGroup(unassigned); }} className="text-xs text-primary-600 hover:text-primary-800">
                            Select all
                          </button>
                        )}
                      </div>
                      {isOpen && (
                        <div className="divide-y divide-gray-100">
                          {unassigned.map((t) => <UserRow key={t.id} u={t} color="gray" />)}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </>
        )}
      </div>

      {/* ────────────────── MODALS ────────────────── */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setModal(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">
                {modal === 'createClass' && 'New Class'}
                {modal === 'editClass' && 'Edit Class'}
                {modal === 'createDept' && 'New Department'}
                {modal === 'editDept' && 'Edit Department'}
                {modal === 'createStudent' && 'Add Student'}
                {modal === 'createTeacher' && 'Add Teacher'}
                {modal === 'editUser' && `Edit ${editItem?.role === 'TEACHER' ? 'Teacher' : 'Student'}`}
                {modal === 'importStudents' && 'Import Students from Excel'}
              </h2>
              <button onClick={() => setModal(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>

            {/* Create/Edit Class */}
            {(modal === 'createClass' || modal === 'editClass') && (
              <form onSubmit={modal === 'createClass' ? handleCreateClass : handleEditClass} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Class Name *</label>
                  <input type="text" className="input-field" placeholder="e.g. ATTN2024" value={form.name || ''}
                    onChange={e => setForm({ ...form, name: e.target.value })} required />
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setModal(null)} className="btn-secondary flex-1">Cancel</button>
                  <button type="submit" className="btn-primary flex-1">Save</button>
                </div>
              </form>
            )}

            {/* Create/Edit Department */}
            {(modal === 'createDept' || modal === 'editDept') && (
              <form onSubmit={modal === 'createDept' ? handleCreateDept : handleEditDept} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Department Name *</label>
                  <input type="text" className="input-field" placeholder="e.g. Computer Science" value={form.name || ''}
                    onChange={e => setForm({ ...form, name: e.target.value })} required />
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setModal(null)} className="btn-secondary flex-1">Cancel</button>
                  <button type="submit" className="btn-primary flex-1">Save</button>
                </div>
              </form>
            )}

            {/* Create Student */}
            {modal === 'createStudent' && (
              <form onSubmit={handleCreateStudent} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Student ID (Username) *</label>
                  <input type="text" className="input-field" placeholder="e.g. 22521000" pattern="\d{8}" title="8 digits"
                    value={form.username || ''} onChange={e => setForm({ ...form, username: e.target.value })} required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Full Name *</label>
                  <input type="text" className="input-field" placeholder="e.g. Nguyen Van B"
                    value={form.fullName || ''} onChange={e => setForm({ ...form, fullName: e.target.value })} required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
                  <input type="text" className="input-field" placeholder="Default: same as Student ID"
                    value={form.password || ''} onChange={e => setForm({ ...form, password: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Class</label>
                  <select className="input-field" value={form.studentClassId || ''} onChange={e => setForm({ ...form, studentClassId: e.target.value })}>
                    <option value="">Unassigned</option>
                    {studentClasses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setModal(null)} className="btn-secondary flex-1">Cancel</button>
                  <button type="submit" className="btn-primary flex-1">Create</button>
                </div>
              </form>
            )}

            {/* Create Teacher */}
            {modal === 'createTeacher' && (
              <form onSubmit={handleCreateTeacher} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Username *</label>
                  <input type="text" className="input-field" placeholder="e.g. Tran Van B"
                    value={form.username || ''} onChange={e => setForm({ ...form, username: e.target.value })} required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Full Name *</label>
                  <input type="text" className="input-field" placeholder="e.g. Tran Van B"
                    value={form.fullName || ''} onChange={e => setForm({ ...form, fullName: e.target.value })} required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
                  <input type="text" className="input-field" placeholder="Default: teacher123"
                    value={form.password || ''} onChange={e => setForm({ ...form, password: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Department</label>
                  <select className="input-field" value={form.departmentId || ''} onChange={e => setForm({ ...form, departmentId: e.target.value })}>
                    <option value="">Unassigned</option>
                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setModal(null)} className="btn-secondary flex-1">Cancel</button>
                  <button type="submit" className="btn-primary flex-1">Create</button>
                </div>
              </form>
            )}

            {/* Edit User */}
            {modal === 'editUser' && editItem && (
              <form onSubmit={handleEditUser} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Full Name *</label>
                  <input type="text" className="input-field" value={form.fullName || ''}
                    onChange={e => setForm({ ...form, fullName: e.target.value })} required />
                </div>
                {editItem.role === 'STUDENT' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Class</label>
                    <select className="input-field" value={form.studentClassId || ''} onChange={e => setForm({ ...form, studentClassId: e.target.value })}>
                      <option value="">Unassigned</option>
                      {studentClasses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                )}
                {editItem.role === 'TEACHER' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Department</label>
                    <select className="input-field" value={form.departmentId || ''} onChange={e => setForm({ ...form, departmentId: e.target.value })}>
                      <option value="">Unassigned</option>
                      {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                )}
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setModal(null)} className="btn-secondary flex-1">Cancel</button>
                  <button type="submit" className="btn-primary flex-1">Save</button>
                </div>
              </form>
            )}

            {/* Import Students */}
            {modal === 'importStudents' && (
              <div className="space-y-4">
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-xs font-medium text-gray-600 mb-2">Excel format (no header row):</p>
                  <table className="text-xs w-full text-gray-700">
                    <thead><tr className="text-gray-500"><th className="text-left pb-1">Col A (Student ID)</th><th className="text-left pb-1">Col B (Full Name)</th></tr></thead>
                    <tbody><tr><td>22521000</td><td>Nguyen Van A</td></tr><tr><td>22521001</td><td>Tran Thi B</td></tr></tbody>
                  </table>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Assign to Class</label>
                  <select className="input-field" value={form.studentClassId || ''} onChange={e => setForm({ ...form, studentClassId: e.target.value })}>
                    <option value="">Unassigned</option>
                    {studentClasses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-primary-400 hover:bg-primary-50 transition-colors flex-1">
                    <Upload size={16} className="text-gray-400" />
                    <span className="text-sm text-gray-600 truncate">{file ? file.name : 'Choose .xlsx or .xls file'}</span>
                    <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) { setFile(f); setImportResult(null); } }} />
                  </label>
                  {file && (
                    <button onClick={handleExcelUpload} disabled={uploading} className="btn-primary flex items-center gap-2">
                      <FileSpreadsheet size={16} />{uploading ? '...' : 'Import'}
                    </button>
                  )}
                </div>
                {importResult && (
                  <div className="space-y-2 text-sm">
                    {importResult.created.length > 0 && (
                      <div className="flex items-start gap-2"><Check size={14} className="text-green-500 mt-0.5" />
                        <span className="text-green-700">Created: {importResult.created.join(', ')}</span></div>
                    )}
                    {importResult.alreadyExists.length > 0 && (
                      <div className="flex items-start gap-2"><AlertTriangle size={14} className="text-amber-500 mt-0.5" />
                        <span className="text-amber-700">Already exists: {importResult.alreadyExists.join(', ')}</span></div>
                    )}
                    {importResult.invalid.length > 0 && (
                      <div className="flex items-start gap-2"><X size={14} className="text-red-500 mt-0.5" />
                        <span className="text-red-700">Invalid: {importResult.invalid.join(', ')}</span></div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Layout>
  );
};

export default AdminDashboard;
