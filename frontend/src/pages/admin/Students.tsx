import React, { useState, useRef } from 'react';
import { UserPlus, Upload, FileSpreadsheet, Check, AlertTriangle, X } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import api from '../../api';

interface ImportResult {
  message: string;
  created: string[];
  alreadyExists: string[];
  invalid: string[];
}

const AdminStudents: React.FC = () => {
  const [tab, setTab] = useState<'single' | 'excel'>('single');

  // Single form
  const [singleForm, setSingleForm] = useState({ username: '', fullName: '', password: '' });
  const [creatingSingle, setCreatingSingle] = useState(false);

  // Excel
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSingleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingSingle(true);
    try {
      const { data } = await api.post('/admin/students', singleForm);
      toast.success(data.message || 'Student created');
      setSingleForm({ username: '', fullName: '', password: '' });
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to create student');
    } finally {
      setCreatingSingle(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      if (!f.name.match(/\.(xlsx|xls)$/i)) {
        toast.error('Please select an Excel file (.xlsx or .xls)');
        return;
      }
      setFile(f);
      setImportResult(null);
    }
  };

  const handleExcelUpload = async () => {
    if (!file) {
      toast.error('Please select a file first');
      return;
    }

    setUploading(true);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await api.post<ImportResult>('/admin/students/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImportResult(data);
      toast.success(data.message);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to import students');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-6 max-w-3xl mx-auto">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Create Student Accounts</h1>
          <p className="text-gray-500 mt-1">Add individual students or import from Excel</p>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="flex gap-6">
            {[
              { id: 'single', label: 'Single Student', icon: <UserPlus size={14} /> },
              { id: 'excel', label: 'Import from Excel', icon: <FileSpreadsheet size={14} /> },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id as 'single' | 'excel')}
                className={`flex items-center gap-2 pb-3 text-sm font-medium border-b-2 transition-colors ${
                  tab === t.id
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Single Student */}
        {tab === 'single' && (
          <div className="card p-6">
            <form onSubmit={handleSingleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Student ID (Username) *
                </label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. 22521000"
                  value={singleForm.username}
                  onChange={(e) => setSingleForm({ ...singleForm, username: e.target.value })}
                  required
                  pattern="\d{8}"
                  title="Must be exactly 8 digits"
                />
                <p className="text-xs text-gray-400 mt-1">Must be exactly 8 digits</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Full Name *
                </label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. Nguyen Van B"
                  value={singleForm.fullName}
                  onChange={(e) => setSingleForm({ ...singleForm, fullName: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Password
                </label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Default: same as Student ID"
                  value={singleForm.password}
                  onChange={(e) => setSingleForm({ ...singleForm, password: e.target.value })}
                />
                <p className="text-xs text-gray-400 mt-1">Leave empty to use student ID as default password</p>
              </div>
              <button type="submit" disabled={creatingSingle} className="btn-primary flex items-center gap-2">
                <UserPlus size={16} />
                {creatingSingle ? 'Creating...' : 'Create Student'}
              </button>
            </form>
          </div>
        )}

        {/* Excel Import */}
        {tab === 'excel' && (
          <div className="space-y-4">
            <div className="card p-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Excel File Format</h3>
              <div className="bg-gray-50 rounded-lg p-4 mb-4">
                <table className="text-sm w-full">
                  <thead>
                    <tr className="text-gray-500">
                      <th className="text-left pb-2 font-medium">Column A (Student ID)</th>
                      <th className="text-left pb-2 font-medium">Column B (Full Name)</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-700">
                    <tr><td>22521000</td><td>Nguyen Van A</td></tr>
                    <tr><td>22521001</td><td>Tran Thi B</td></tr>
                    <tr><td>22521002</td><td>Le Van C</td></tr>
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-500 mb-4">
                No header row needed. Column A = Student ID (8 digits), Column B = Full Name.
                Default password is the student ID.
              </p>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-primary-400 hover:bg-primary-50 transition-colors">
                  <Upload size={16} className="text-gray-400" />
                  <span className="text-sm text-gray-600">
                    {file ? file.name : 'Choose .xlsx or .xls file'}
                  </span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </label>

                {file && (
                  <>
                    <button
                      onClick={handleExcelUpload}
                      disabled={uploading}
                      className="btn-primary flex items-center gap-2"
                    >
                      <FileSpreadsheet size={16} />
                      {uploading ? 'Importing...' : 'Import'}
                    </button>
                    <button
                      onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <X size={16} />
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Import Results */}
            {importResult && (
              <div className="card p-6 space-y-3">
                <h3 className="font-semibold text-gray-900">{importResult.message}</h3>

                {importResult.created.length > 0 && (
                  <div className="flex items-start gap-2">
                    <Check size={16} className="text-green-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-green-700">
                        Created ({importResult.created.length})
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {importResult.created.join(', ')}
                      </p>
                    </div>
                  </div>
                )}

                {importResult.alreadyExists.length > 0 && (
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-amber-700">
                        Already exists ({importResult.alreadyExists.length})
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {importResult.alreadyExists.join(', ')}
                      </p>
                    </div>
                  </div>
                )}

                {importResult.invalid.length > 0 && (
                  <div className="flex items-start gap-2">
                    <X size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-red-700">
                        Invalid ({importResult.invalid.length})
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {importResult.invalid.join(', ')}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
};

export default AdminStudents;
