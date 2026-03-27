import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, ChevronRight, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../../components/Layout';
import LoadingSpinner from '../../components/LoadingSpinner';
import api from '../../api';
import { Class } from '../../types';

const TeacherClasses: React.FC = () => {
  const [classes, setClasses] = useState<Class[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchClasses = async () => {
    setLoading(true);
    try {
      const { data } = await api.get<Class[]>('/classes');
      setClasses(data);
    } catch {
      toast.error('Failed to load classes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchClasses(); }, []);

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Delete class "${name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/classes/${id}`);
      toast.success('Class deleted');
      fetchClasses();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to delete');
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Courses</h1>
          <p className="text-gray-500 mt-1">View and manage your assigned courses</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
        ) : classes.length === 0 ? (
          <div className="card p-12 text-center">
            <Users size={48} className="text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-700 mb-2">No classes assigned</h3>
            <p className="text-gray-400">Contact your admin to be assigned to a class</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {classes.map((cls) => (
              <div key={cls.id} className="card p-5 hover:shadow-md transition-shadow group">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-lg bg-primary-100 flex items-center justify-center">
                    <Users size={20} className="text-primary-600" />
                  </div>
                  <button
                    onClick={() => handleDelete(cls.id, cls.name)}
                    className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <h3 className="font-semibold text-gray-900 mb-1">{cls.name}</h3>
                {cls.description && (
                  <p className="text-sm text-gray-500 mb-3 line-clamp-2">{cls.description}</p>
                )}
                <div className="flex items-center justify-between text-sm text-gray-500 mb-4">
                  <span>{cls._count?.students ?? 0} students</span>
                  <span>{cls._count?.sessions ?? 0} sessions</span>
                </div>
                <Link
                  to={`/teacher/classes/${cls.id}`}
                  className="flex items-center justify-center gap-2 w-full py-2 bg-primary-50 hover:bg-primary-100 text-primary-700 text-sm font-medium rounded-lg transition-colors"
                >
                  Open Class <ChevronRight size={14} />
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
};

export default TeacherClasses;

