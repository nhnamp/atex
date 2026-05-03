import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, BookOpen, FileText, ChevronRight, TrendingUp } from 'lucide-react';
import Layout from '../../components/Layout';
import LoadingSpinner from '../../components/LoadingSpinner';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import { Class, Subject } from '../../types';

const TeacherDashboard: React.FC = () => {
  const { user } = useAuth();
  const [classes, setClasses] = useState<Class[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [classRes, subjectRes] = await Promise.all([
          api.get<Class[]>('/classes'),
          api.get<Subject[]>('/subjects'),
        ]);
        setClasses(classRes.data);
        setSubjects(subjectRes.data);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const totalStudents = classes.reduce((acc, c) => acc + (c._count?.students ?? 0), 0);
  const totalQuestions = subjects.reduce((acc, s) => acc + (s._count?.questions ?? 0), 0);

  const stats = [
    { label: 'Classes', value: classes.length, icon: <Users size={20} />, color: 'bg-blue-100 text-blue-600', link: '/teacher/classes' },
    { label: 'Students', value: totalStudents, icon: <TrendingUp size={20} />, color: 'bg-green-100 text-green-600', link: '/teacher/classes' },
    { label: 'Subjects', value: subjects.length, icon: <BookOpen size={20} />, color: 'bg-purple-100 text-purple-600', link: '/teacher/subjects' },
    { label: 'Questions', value: totalQuestions, icon: <FileText size={20} />, color: 'bg-orange-100 text-orange-600', link: '/teacher/subjects' },
  ];

  return (
    <Layout>
      <div className="space-y-6">
        {/* Welcome */}
        <div className="bg-gradient-to-r from-primary-600 to-primary-700 rounded-xl p-6 text-white">
          <h1 className="text-2xl font-bold">Welcome back, {user?.fullName}! 👋</h1>
          <p className="mt-1 text-primary-200">Manage your classes, attendance, and exams</p>
        </div>

        {/* Stats */}
        {loading ? (
          <div className="flex justify-center py-8"><LoadingSpinner size="lg" /></div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {stats.map((s) => (
              <Link key={s.label} to={s.link} className="card p-5 hover:shadow-md transition-shadow">
                <div className={`w-10 h-10 rounded-lg ${s.color} flex items-center justify-center mb-3`}>
                  {s.icon}
                </div>
                <p className="text-2xl font-bold text-gray-900">{s.value}</p>
                <p className="text-sm text-gray-500">{s.label}</p>
              </Link>
            ))}
          </div>
        )}

        {/* Quick Actions */}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="card p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Quick Actions</h3>
            <div className="space-y-2">
              {[
                { label: 'Manage classes', to: '/teacher/classes', icon: <Users size={16} /> },
                { label: 'Manage subjects & questions', to: '/teacher/subjects', icon: <BookOpen size={16} /> },
                { label: 'Generate AI exam', to: '/teacher/exams', icon: <FileText size={16} /> },
              ].map((action) => (
                <Link
                  key={action.to}
                  to={action.to}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-primary-50 border border-gray-100 hover:border-primary-200 transition-all group"
                >
                  <div className="flex items-center gap-3 text-sm font-medium text-gray-700 group-hover:text-primary-600">
                    <span className="text-primary-500">{action.icon}</span>
                    {action.label}
                  </div>
                  <ChevronRight size={16} className="text-gray-400 group-hover:text-primary-500" />
                </Link>
              ))}
            </div>
          </div>

          {/* Recent Classes */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900">Recent Classes</h3>
              <Link to="/teacher/classes" className="text-sm text-primary-600 hover:text-primary-700">
                View all
              </Link>
            </div>
            {classes.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No classes yet</p>
            ) : (
              <div className="space-y-2">
                {classes.slice(0, 4).map((cls) => (
                  <Link
                    key={cls.id}
                    to={`/teacher/classes/${cls.id}`}
                    className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 border border-gray-100 transition-colors"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-900">{cls.name}</p>
                      <p className="text-xs text-gray-500">{cls._count?.students ?? 0} students</p>
                    </div>
                    <ChevronRight size={16} className="text-gray-400" />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default TeacherDashboard;
