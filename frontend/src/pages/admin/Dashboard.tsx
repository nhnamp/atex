import React, { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Users, Clock, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import LoadingSpinner from '../../components/LoadingSpinner';
import api from '../../api';
import { User } from '../../types';

const AdminDashboard: React.FC = () => {
  const [pendingTeachers, setPendingTeachers] = useState<User[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'pending' | 'all'>('pending');

  const fetchData = async () => {
    setLoading(true);
    try {
      const [pendingRes, allRes] = await Promise.all([
        api.get<User[]>('/admin/pending-teachers'),
        api.get<User[]>('/admin/users'),
      ]);
      setPendingTeachers(pendingRes.data);
      setAllUsers(allRes.data);
    } catch {
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleApprove = async (userId: number, name: string) => {
    try {
      await api.put(`/admin/approve/${userId}`);
      toast.success(`Approved ${name}`);
      fetchData();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to approve');
    }
  };

  const handleReject = async (userId: number, name: string) => {
    try {
      await api.put(`/admin/reject/${userId}`);
      toast.success(`Rejected ${name}`);
      fetchData();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to reject');
    }
  };

  const teachers = allUsers.filter((u) => u.role === 'TEACHER');
  const students = allUsers.filter((u) => u.role === 'STUDENT');

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
            <p className="text-gray-500 mt-1">Manage user accounts and approvals</p>
          </div>
          <button onClick={fetchData} className="btn-secondary flex items-center gap-2">
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="card p-5">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-yellow-100 flex items-center justify-center">
                <Clock size={20} className="text-yellow-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{pendingTeachers.length}</p>
                <p className="text-sm text-gray-500">Pending Approvals</p>
              </div>
            </div>
          </div>
          <div className="card p-5">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <Users size={20} className="text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{teachers.length}</p>
                <p className="text-sm text-gray-500">Total Teachers</p>
              </div>
            </div>
          </div>
          <div className="card p-5">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                <Users size={20} className="text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{students.length}</p>
                <p className="text-sm text-gray-500">Total Students</p>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="flex gap-6">
            {[
              { id: 'pending', label: `Pending Approvals (${pendingTeachers.length})` },
              { id: 'all', label: `All Users (${allUsers.length})` },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id as 'pending' | 'all')}
                className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                  tab === t.id
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex justify-center py-12">
            <LoadingSpinner size="lg" />
          </div>
        ) : tab === 'pending' ? (
          <div className="card overflow-hidden">
            {pendingTeachers.length === 0 ? (
              <div className="text-center py-12">
                <CheckCircle size={48} className="text-green-400 mx-auto mb-3" />
                <p className="text-gray-500">No pending approvals</p>
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-6 py-3">
                      Teacher
                    </th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-6 py-3">
                      Username
                    </th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-6 py-3">
                      Registered
                    </th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-6 py-3">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pendingTeachers.map((teacher) => (
                    <tr key={teacher.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 font-bold text-sm">
                            {teacher.fullName.charAt(0)}
                          </div>
                          <span className="font-medium text-gray-900">{teacher.fullName}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">{teacher.username}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {new Date(teacher.createdAt!).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleApprove(teacher.id, teacher.fullName)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-green-50 text-green-700 hover:bg-green-100 rounded-lg transition-colors"
                          >
                            <CheckCircle size={14} />
                            Approve
                          </button>
                          <button
                            onClick={() => handleReject(teacher.id, teacher.fullName)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-50 text-red-700 hover:bg-red-100 rounded-lg transition-colors"
                          >
                            <XCircle size={14} />
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-6 py-3">User</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-6 py-3">Username</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-6 py-3">Role</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-6 py-3">Status</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-6 py-3">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {allUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center font-bold text-sm text-gray-600">
                          {u.fullName.charAt(0)}
                        </div>
                        <span className="font-medium text-gray-900 text-sm">{u.fullName}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{u.username}</td>
                    <td className="px-6 py-4">
                      <span className={`badge ${u.role === 'TEACHER' ? 'badge-blue' : 'badge-green'}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`badge ${
                          u.status === 'APPROVED'
                            ? 'badge-green'
                            : u.status === 'PENDING'
                            ? 'badge-yellow'
                            : 'badge-red'
                        }`}
                      >
                        {u.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {new Date(u.createdAt!).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default AdminDashboard;
