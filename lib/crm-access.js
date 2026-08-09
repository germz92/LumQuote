/**
 * Project ownership / sharing helpers (mirrors quote access in server.js).
 * Uses mongoose models registered by server.js: User, LumQuoteUser.
 */

const mongoose = require('mongoose');
const { Project } = require('./crm-models');

function userModel() {
  return mongoose.model('User');
}

function lumQuoteUserModel() {
  return mongoose.model('LumQuoteUser');
}

function userDisplayName(user) {
  return user?.name || user?.fullName || '';
}

function isProjectOwner(user, project) {
  if (!user || !project?.createdBy) return false;
  const createdByName = project.createdBy.name || project.createdBy;
  return user.name === createdByName || user.fullName === createdByName;
}

async function resolveAccessIdentities(user) {
  const name = userDisplayName(user);
  const lumOr = [{ name: user.name }, { name: user.fullName }].filter((c) => c.name);
  const [userRecord, lumQuoteUser] = await Promise.all([
    name ? userModel().findOne({ name }) : null,
    lumOr.length ? lumQuoteUserModel().findOne({ $or: lumOr }) : null
  ]);
  return { userRecord, lumQuoteUser };
}

/**
 * Mongo filter for projects the user may see.
 * Admins: {}. Non-admins with no identity: { _id: null } (match nothing).
 */
async function buildProjectAccessQuery(user) {
  if (!user) return { _id: null };
  if (user.role === 'admin') return {};

  const { userRecord, lumQuoteUser } = await resolveAccessIdentities(user);
  const orConditions = [];
  if (userRecord) orConditions.push({ createdBy: userRecord._id });
  if (lumQuoteUser) orConditions.push({ 'sharedWith.user': lumQuoteUser._id });
  if (orConditions.length === 0) return { _id: null };
  return { $or: orConditions };
}

function mergeAccessIntoQuery(query, accessQuery) {
  if (!accessQuery || Object.keys(accessQuery).length === 0) return query;
  if (accessQuery._id === null) {
    return { _id: null };
  }
  if (accessQuery.$or) {
    const next = { ...query };
    next.$and = (next.$and || []).concat([{ $or: accessQuery.$or }]);
    return next;
  }
  return { ...query, ...accessQuery };
}

/**
 * @returns {false|'read'|'full'} when returnAccessLevel, else boolean
 */
async function canAccessProject(user, project, returnAccessLevel = false) {
  if (!user || !project) return false;
  if (user.role === 'admin') return returnAccessLevel ? 'full' : true;

  if (isProjectOwner(user, project)) {
    return returnAccessLevel ? 'full' : true;
  }

  if (project.sharedWith && project.sharedWith.length > 0) {
    const { lumQuoteUser } = await resolveAccessIdentities(user);
    if (lumQuoteUser) {
      const shareEntry = project.sharedWith.find((s) =>
        s.user
        && (s.user.toString() === lumQuoteUser._id.toString()
          || s.user._id?.toString() === lumQuoteUser._id.toString())
      );
      if (shareEntry) {
        return returnAccessLevel ? (shareEntry.accessLevel || 'read') : true;
      }
    }
  }

  return false;
}

async function loadProjectForAccess(projectId) {
  return Project.findById(projectId)
    .populate('createdBy', 'name')
    .populate('sharedWith.user', 'name email');
}

/**
 * Express-style guard. Sends 404/403 and returns null on failure.
 * @param {{ minLevel?: 'read'|'full', ownerOrAdmin?: boolean }} opts
 */
async function requireProjectAccess(req, res, projectId, opts = {}) {
  const { minLevel = 'read', ownerOrAdmin = false } = opts;
  const project = await loadProjectForAccess(projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return null;
  }

  const accessLevel = await canAccessProject(req.user, project, true);
  if (!accessLevel) {
    res.status(403).json({ error: 'You do not have access to this project' });
    return null;
  }

  const owner = isProjectOwner(req.user, project);
  if (ownerOrAdmin) {
    if (req.user.role !== 'admin' && !owner) {
      res.status(403).json({ error: 'Only the project owner or an admin can do this' });
      return null;
    }
  } else if (minLevel === 'full' && accessLevel === 'read') {
    res.status(403).json({ error: 'You have read-only access to this project' });
    return null;
  }

  return {
    project,
    accessLevel,
    isOwner: owner
  };
}

function annotateProjectAccessFields(user, project, accessLevel) {
  const plain = typeof project.toObject === 'function' ? project.toObject() : { ...project };
  plain.accessLevel = accessLevel || 'full';
  plain.isOwner = isProjectOwner(user, project);
  return plain;
}

async function getAccessibleProjectIds(user) {
  const accessQuery = await buildProjectAccessQuery(user);
  if (accessQuery._id === null) return [];
  const projects = await Project.find(accessQuery, { _id: 1 });
  return projects.map((p) => p._id);
}

module.exports = {
  isProjectOwner,
  resolveAccessIdentities,
  buildProjectAccessQuery,
  mergeAccessIntoQuery,
  canAccessProject,
  loadProjectForAccess,
  requireProjectAccess,
  annotateProjectAccessFields,
  getAccessibleProjectIds
};
