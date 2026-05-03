import React from 'react';
import Layout from '../../components/Layout';
import ChangePasswordForm from '../../components/ChangePasswordForm';

const StudentAccount: React.FC = () => {
  return (
    <Layout>
      <div className="space-y-6 max-w-xl">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Account Settings</h1>
          <p className="text-gray-500 mt-1">Manage your password and account security.</p>
        </div>
        <ChangePasswordForm />
      </div>
    </Layout>
  );
};

export default StudentAccount;
