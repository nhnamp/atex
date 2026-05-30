import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';

const prisma = new PrismaClient();

/**
 * Enroll face descriptors for a student.
 * Body: { studentId: number, descriptors: number[][] }
 * Each descriptor is a 128-dim float array.
 */
export const enrollFace = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { studentId, descriptors } = req.body;

    if (!studentId || !descriptors || !Array.isArray(descriptors) || descriptors.length === 0) {
      res.status(400).json({ error: 'studentId and descriptors (array of 128-dim arrays) are required' });
      return;
    }

    // Verify student exists
    const student = await prisma.user.findUnique({ where: { id: studentId } });
    if (!student || student.role !== 'STUDENT') {
      res.status(404).json({ error: 'Student not found' });
      return;
    }

    // Validate each descriptor is a 128-length array of numbers
    for (const desc of descriptors) {
      if (!Array.isArray(desc) || desc.length !== 128) {
        res.status(400).json({ error: 'Each descriptor must be an array of 128 numbers' });
        return;
      }
    }

    // Delete existing descriptors for this student (re-enrollment)
    await prisma.faceDescriptor.deleteMany({ where: { studentId } });

    // Create new descriptors
    const created = await prisma.faceDescriptor.createMany({
      data: descriptors.map((desc: number[]) => ({
        studentId,
        descriptor: JSON.stringify(desc),
      })),
    });

    res.status(201).json({
      success: true,
      message: `Enrolled ${created.count} face descriptor(s) for student ${student.fullName}`,
      count: created.count,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get all enrolled face descriptors for students in a class.
 * Returns grouped by student for building FaceMatcher on client.
 */
export const getClassDescriptors = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const classId = parseInt(String(req.params.classId), 10);

    // Verify teacher owns this class
    const cls = await prisma.class.findUnique({ where: { id: classId } });
    if (!cls || cls.teacherId !== req.user!.id) {
      res.status(404).json({ error: 'Class not found' });
      return;
    }

    // Get all students in the class
    const classStudents = await prisma.classStudent.findMany({
      where: { classId },
      include: {
        student: {
          select: { id: true, username: true, fullName: true },
        },
      },
    });

    const studentIds = classStudents.map((cs: { student: { id: number } }) => cs.student.id);

    // Get all face descriptors for these students
    const allDescriptors = await prisma.faceDescriptor.findMany({
      where: { studentId: { in: studentIds } },
    });

    // Group by student
    const descriptorMap = new Map<number, number[][]>();
    for (const fd of allDescriptors) {
      const arr = descriptorMap.get(fd.studentId) || [];
      arr.push(JSON.parse(fd.descriptor));
      descriptorMap.set(fd.studentId, arr);
    }

    const result = classStudents.map((item: { student: { id: number; username: string; fullName: string } }) => ({
      student: item.student,
      descriptors: descriptorMap.get(item.student.id) || [],
      enrolled: descriptorMap.has(item.student.id),
    }));

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Delete all face descriptors for a student.
 */
export const deleteFaceData = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const studentId = parseInt(String(req.params.studentId), 10);

    const deleted = await prisma.faceDescriptor.deleteMany({ where: { studentId } });

    res.json({
      success: true,
      message: `Deleted ${deleted.count} face descriptor(s)`,
      count: deleted.count,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Check if a student has enrolled face data.
 */
export const getFaceStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const studentId = parseInt(String(req.params.studentId), 10);

    const count = await prisma.faceDescriptor.count({ where: { studentId } });

    res.json({
      studentId,
      enrolled: count > 0,
      descriptorCount: count,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
