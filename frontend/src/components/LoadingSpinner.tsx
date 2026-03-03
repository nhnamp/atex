import React from 'react';

interface Props {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const LoadingSpinner: React.FC<Props> = ({ size = 'md', className = '' }) => {
  const sizeClass = { sm: 'h-4 w-4', md: 'h-8 w-8', lg: 'h-12 w-12' }[size];
  return (
    <div className={`animate-spin rounded-full border-b-2 border-primary-600 ${sizeClass} ${className}`} />
  );
};

export default LoadingSpinner;
