import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronDown, ChevronRight, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import Layout from '../../components/Layout';
import LoadingSpinner from '../../components/LoadingSpinner';
import api from '../../api';
import { Class } from '../../types';

interface SummarySession {
  id: number;
  name: string;
  status: 'ACTIVE' | 'COMPLETED';
  startedAt: string;
}

type DetailStatus = 'PRESENT' | 'ABSENT' | 'ACTIVE';

interface StudentSummary {
  student: { id: number; username: string; fullName: string };
  totalLessons: number;
  present: number;
  absent: number;
  details: { sessionId: number; status: DetailStatus }[];
}

interface SummaryResponse {
  classId: number;
  sessions: SummarySession[];
  students: StudentSummary[];
}

const TeacherAttendanceSummary: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [cls, setCls] = useState<Class | null>(null);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [classRes, summaryRes] = await Promise.all([
          api.get<Class>(`/classes/${id}`),
          api.get<SummaryResponse>(`/attendance/sessions/class/${id}/summary`),
        ]);
        setCls(classRes.data);
        setSummary(summaryRes.data);
      } catch {
        toast.error('Failed to load attendance summary');
        navigate('/teacher/classes');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id, navigate]);

  const toggleExpanded = (studentId: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  };

  const sessionIndex = useMemo(() => {
    if (!summary) return new Map<number, SummarySession>();
    return new Map(summary.sessions.map((s) => [s.id, s]));
  }, [summary]);

  const handleExport = () => {
    if (!summary) return;

    const headers = [
      'Student ID',
      'Name',
      'Total lessons',
      'Present',
      'Absent',
      ...summary.sessions.map((s) => s.name),
    ];

    const rows = summary.students.map((student) => {
      const detailMap = new Map(student.details.map((d) => [d.sessionId, d.status]));
      const sessionStatuses = summary.sessions.map((s) => detailMap.get(s.id) ?? 'ABSENT');
      return [
        student.student.username,
        student.student.fullName,
        student.totalLessons,
        student.present,
        student.absent,
        ...sessionStatuses,
      ];
    });

    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Attendance Summary');

    const safeName = cls?.name ? cls.name.replace(/\s+/g, '-').toLowerCase() : `class-${summary.classId}`;
    XLSX.writeFile(workbook, `attendance-summary-${safeName}.xlsx`);
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
      </Layout>
    );
  }

  if (!summary || !cls) return null;

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <Link to={`/teacher/classes/${id}`} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
            <ArrowLeft size={16} /> Back to Class
          </Link>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Attendance Summary</h1>
              <p className="text-sm text-gray-500 mt-1">{cls.name}</p>
            </div>
            <button onClick={handleExport} className="btn-secondary flex items-center gap-2">
              <Download size={16} /> Export .xlsx
            </button>
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Class Attendance</h2>
          </div>
          {!summary.students.length ? (
            <div className="p-8 text-center">
              <p className="text-sm text-gray-400">No students found</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase px-5 py-3">Student ID</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase px-5 py-3">Name</th>
                  <th className="text-center text-xs font-semibold text-gray-500 uppercase px-3 py-3">Total</th>
                  <th className="text-center text-xs font-semibold text-gray-500 uppercase px-3 py-3">Present</th>
                  <th className="text-center text-xs font-semibold text-gray-500 uppercase px-3 py-3">Absent</th>
                  <th className="text-center text-xs font-semibold text-gray-500 uppercase px-5 py-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {summary.students.map((student) => {
                  const isOpen = expanded.has(student.student.id);
                  const detailMap = new Map(student.details.map((d) => [d.sessionId, d.status]));

                  return (
                    <React.Fragment key={student.student.id}>
                      <tr className="hover:bg-gray-50">
                        <td className="px-5 py-3 text-sm text-gray-900">{student.student.username}</td>
                        <td className="px-5 py-3">
                          <p className="text-sm font-medium text-gray-900">{student.student.fullName}</p>
                        </td>
                        <td className="px-3 py-3 text-center text-sm text-gray-900">{student.totalLessons}</td>
                        <td className="px-3 py-3 text-center text-sm text-green-700">{student.present}</td>
                        <td className="px-3 py-3 text-center text-sm text-red-600">{student.absent}</td>
                        <td className="px-5 py-3 text-center">
                          <button
                            onClick={() => toggleExpanded(student.student.id)}
                            className="inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800"
                          >
                            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            {isOpen ? 'Hide' : 'View'}
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-gray-50">
                          <td colSpan={6} className="px-5 py-4">
                            <div className="grid sm:grid-cols-2 gap-3">
                              {summary.sessions.map((session) => {
                                const status = detailMap.get(session.id) ?? 'ABSENT';
                                const badgeClass =
                                  status === 'PRESENT'
                                    ? 'badge-green'
                                    : status === 'ACTIVE'
                                    ? 'badge-gray'
                                    : 'badge-red';
                                return (
                                  <div key={session.id} className="flex items-center justify-between bg-white border border-gray-100 rounded-lg px-4 py-2">
                                    <div>
                                      <p className="text-sm font-medium text-gray-900">{session.name}</p>
                                      <p className="text-xs text-gray-500">
                                        {new Date(session.startedAt).toLocaleString()}
                                      </p>
                                    </div>
                                    <span className={`badge text-xs ${badgeClass}`}>{status}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default TeacherAttendanceSummary;
