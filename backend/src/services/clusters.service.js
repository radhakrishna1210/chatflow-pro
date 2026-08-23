import { prisma } from '../lib/prisma.js';

export async function listClusters(workspaceId) {
  const clusters = await prisma.cluster.findMany({
    where: { workspaceId },
    include: {
      contacts: {
        include: {
          contact: true,
        },
      },
      _count: {
        select: { contacts: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return clusters.map((c) => ({
    id: c.id,
    workspaceId: c.workspaceId,
    name: c.name,
    description: c.description,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    memberCount: c._count?.contacts ?? c.contacts?.length ?? 0,
    memberContacts: (c.contacts ?? []).map((cc) => cc.contact),
  }));
}

export async function getCluster(workspaceId, id) {
  const c = await prisma.cluster.findFirst({
    where: { id, workspaceId },
    include: {
      contacts: {
        include: {
          contact: true,
        },
      },
      _count: {
        select: { contacts: true },
      },
    },
  });
  if (!c) {
    const e = new Error('Cluster not found');
    e.status = 404;
    throw e;
  }
  return {
    id: c.id,
    workspaceId: c.workspaceId,
    name: c.name,
    description: c.description,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    memberCount: c._count?.contacts ?? c.contacts?.length ?? 0,
    memberContacts: (c.contacts ?? []).map((cc) => cc.contact),
  };
}

export async function createCluster(workspaceId, { name, description = null, contactIds = [] }) {
  if (!name || !String(name).trim()) {
    const e = new Error('Cluster name is required');
    e.status = 400;
    throw e;
  }
  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    const e = new Error('At least one contact must be selected');
    e.status = 400;
    throw e;
  }

  const trimmedName = String(name).trim();
  const existing = await prisma.cluster.findFirst({
    where: { workspaceId, name: trimmedName },
  });
  if (existing) {
    const e = new Error('A cluster with this name already exists');
    e.status = 409;
    throw e;
  }

  const validContacts = await prisma.contact.findMany({
    where: {
      workspaceId,
      id: { in: contactIds },
    },
    select: { id: true },
  });

  if (validContacts.length === 0) {
    const e = new Error('Invalid contact selection');
    e.status = 400;
    throw e;
  }

  const created = await prisma.cluster.create({
    data: {
      workspaceId,
      name: trimmedName,
      description: description ? String(description).trim() : null,
      contacts: {
        create: validContacts.map((vc) => ({ contactId: vc.id })),
      },
    },
  });

  return getCluster(workspaceId, created.id);
}

export async function updateCluster(workspaceId, id, { name, description, contactIds }) {
  const existing = await prisma.cluster.findFirst({ where: { id, workspaceId } });
  if (!existing) {
    const e = new Error('Cluster not found');
    e.status = 404;
    throw e;
  }

  const data = {};
  if (name !== undefined) {
    const trimmedName = String(name).trim();
    if (!trimmedName) {
      const e = new Error('Cluster name is required');
      e.status = 400;
      throw e;
    }
    data.name = trimmedName;
    if (data.name !== existing.name) {
      const duplicate = await prisma.cluster.findFirst({ where: { workspaceId, name: data.name } });
      if (duplicate) {
        const e = new Error('A cluster with this name already exists');
        e.status = 409;
        throw e;
      }
    }
  }

  if (description !== undefined) {
    data.description = description ? String(description).trim() : null;
  }

  await prisma.$transaction(async (tx) => {
    await tx.cluster.update({
      where: { id },
      data,
    });

    if (contactIds !== undefined) {
      if (!Array.isArray(contactIds) || contactIds.length === 0) {
        const e = new Error('At least one contact must be selected');
        e.status = 400;
        throw e;
      }
      const validContacts = await tx.contact.findMany({
        where: {
          workspaceId,
          id: { in: contactIds },
        },
        select: { id: true },
      });
      if (validContacts.length === 0) {
        const e = new Error('Invalid contact selection');
        e.status = 400;
        throw e;
      }
      await tx.clusterContact.deleteMany({ where: { clusterId: id } });
      await tx.clusterContact.createMany({
        data: validContacts.map((vc) => ({ clusterId: id, contactId: vc.id })),
        skipDuplicates: true,
      });
    }
  });

  return getCluster(workspaceId, id);
}

export async function deleteCluster(workspaceId, id) {
  const existing = await prisma.cluster.findFirst({ where: { id, workspaceId } });
  if (!existing) {
    const e = new Error('Cluster not found');
    e.status = 404;
    throw e;
  }
  await prisma.cluster.delete({ where: { id } });
}
