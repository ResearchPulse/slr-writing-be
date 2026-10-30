import type { Project } from '../../generated/prisma/client.js';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../config/prisma.js';
import { ConflictError, NotFoundError } from '../../shared/errors/app-error.js';

export async function createProject(ownerId: string, input: { name: string; slrProjectId: string }): Promise<Project> {
  try {
    return await prisma.$transaction(async (tx) => {
      const project = await tx.project.create({ data: { name: input.name, ownerId, slrProjectId: input.slrProjectId } });
      await tx.provenanceEvent.create({
        data: {
          projectId: project.id, actor: ownerId, activity: 'project.create',
          outputRefs: { projectId: project.id, slrProjectId: input.slrProjectId } as Prisma.InputJsonValue,
        },
      });
      return project;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictError('This SLR project is already linked to a writing project', 'PROJECT_EXISTS');
    }
    throw error;
  }
}

export const listProjects = (ownerId: string): Promise<Project[]> =>
  prisma.project.findMany({ where: { ownerId }, orderBy: { createdAt: 'desc' } });

/**
 * Loads a project the user owns. Someone else's project is reported as not found, so ids cannot be probed.
 */
export async function getOwnedProject(ownerId: string, projectId: string): Promise<Project> {
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId } });
  if (!project) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  return project;
}
