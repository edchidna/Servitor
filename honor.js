
const honorDatabase = require('./honor-database');
const db = honorDatabase.db;

// ==========================================
// HONOR SYSTEM
// ==========================================

function getAllHonors() {
    return db.prepare(`
        SELECT honor_id, display_name, display_order
        FROM honors
        ORDER BY display_order ASC
    `).all();
}

function getHonorById(honorId) {
    return db.prepare(`
        SELECT honor_id, display_name, display_order
        FROM honors
        WHERE honor_id = ?
    `).get(honorId);
}

function getMemberHonors(guildId, userId) {
    return db.prepare(`
        SELECT
            ha.id,
            ha.honor_id,
            h.display_name,
            h.display_order,
            ha.awarded_by,
            ha.awarded_at
        FROM honor_awards ha
        INNER JOIN honors h
            ON h.honor_id = ha.honor_id
        WHERE ha.guild_id = ?
          AND ha.user_id = ?
          AND ha.is_active = 1
        ORDER BY h.display_order ASC
    `).all(guildId, userId);
}

function awardHonor(guildId, userId, honorId, moderatorId) {
    const honor = getHonorById(honorId);

    if (!honor) {
        return {
            success: false,
            message: 'This Honor does not exist.'
        };
    }

    const existingAward = db.prepare(`
        SELECT id
        FROM honor_awards
        WHERE guild_id = ?
          AND user_id = ?
          AND honor_id = ?
          AND is_active = 1
    `).get(guildId, userId, honorId);

    if (existingAward) {
        return {
            success: false,
            message: 'This member already has this Honor.'
        };
    }

    db.prepare(`
        INSERT INTO honor_awards (
            guild_id,
            user_id,
            honor_id,
            awarded_by
        )
        VALUES (?, ?, ?, ?)
    `).run(guildId, userId, honorId, moderatorId);

    return {
        success: true,
        message: `${honor.display_name} awarded successfully.`,
        honor
    };
}


function removeHonor(guildId, userId, honorId, moderatorId) {
    const activeAward = db.prepare(`
        SELECT id
        FROM honor_awards
        WHERE guild_id = ?
          AND user_id = ?
          AND honor_id = ?
          AND is_active = 1
    `).get(guildId, userId, honorId);

    if (!activeAward) {
        return {
            success: false,
            message: 'This member does not have this active Honor.'
        };
    }

    db.prepare(`
        UPDATE honor_awards
        SET
            is_active = 0,
            removed_by = ?,
            removed_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(moderatorId, activeAward.id);

    return {
        success: true,
        message: 'Honor removed successfully.'
    };
}

function getMemberHonorHistory(guildId, userId) {
    return db.prepare(`
        SELECT
            ha.id,
            ha.honor_id,
            h.display_name,
            ha.awarded_by,
            ha.awarded_at,
            ha.is_active,
            ha.removed_by,
            ha.removed_at
        FROM honor_awards ha
        INNER JOIN honors h
            ON h.honor_id = ha.honor_id
        WHERE ha.guild_id = ?
          AND ha.user_id = ?
        ORDER BY ha.awarded_at DESC, ha.id DESC
    `).all(guildId, userId);
}

function renameHonor(honorId, newName) {
    const honor = getHonorById(honorId);

    if (!honor) {
        return {
            success: false,
            message: 'This Honor does not exist.'
        };
    }

    const displayName = newName.trim();

    if (!displayName || displayName.length > 50) {
        return {
            success: false,
            message: 'Honor name must be between 1 and 50 characters.'
        };
    }

    db.prepare(`
        UPDATE honors
        SET display_name = ?
        WHERE honor_id = ?
    `).run(displayName, honorId);

    return {
        success: true,
        message: `Honor renamed to ${displayName}.`,
        honor: getHonorById(honorId)
    };
}

function getHonorLayout(guildId) {
    const settings = db.prepare(`
        SELECT layout_mode
        FROM honor_settings
        WHERE guild_id = ?
    `).get(guildId);

    return settings?.layout_mode || 'fixed';
}

function setHonorLayout(guildId, layoutMode) {
    if (!['fixed', 'sequential'].includes(layoutMode)) {
        return {
            success: false,
            message: 'Invalid layout mode. Use fixed or sequential.'
        };
    }

    db.prepare(`
        INSERT INTO honor_settings (guild_id, layout_mode)
        VALUES (?, ?)
        ON CONFLICT(guild_id)
        DO UPDATE SET layout_mode = excluded.layout_mode
    `).run(guildId, layoutMode);

    return {
        success: true,
        message: `Honor layout changed to ${layoutMode}.`,
        layoutMode
    };
}

function getHonorDisplayLayout(guildId, userId) {
    const layoutMode = getHonorLayout(guildId);

    const activeHonors = db.prepare(`
        SELECT
            ha.id,
            ha.honor_id,
            h.display_name,
            h.display_order,
            ha.awarded_at
        FROM honor_awards ha
        INNER JOIN honors h
            ON h.honor_id = ha.honor_id
        WHERE ha.guild_id = ?
          AND ha.user_id = ?
          AND ha.is_active = 1
        ORDER BY ha.awarded_at ASC, ha.id ASC
    `).all(guildId, userId);

    const leftColumn = Array(5).fill(null);
    const rightColumn = Array(5).fill(null);

    if (layoutMode === 'fixed') {
        for (const honor of activeHonors) {
            if (honor.display_order >= 1 && honor.display_order <= 5) {
                leftColumn[honor.display_order - 1] = honor;
            } else if (
                honor.display_order >= 6 &&
                honor.display_order <= 10
            ) {
                rightColumn[honor.display_order - 6] = honor;
            }
        }
    } else {
        activeHonors.forEach((honor, index) => {
            if (index < 5) {
                leftColumn[index] = honor;
            } else if (index < 10) {
                rightColumn[index - 5] = honor;
            }
        });
    }

    return {
        layoutMode,
        leftColumn,
        rightColumn
    };
}

module.exports = {
    getAllHonors,
    getHonorById,
    getMemberHonors,
    awardHonor,
    removeHonor,
    getMemberHonorHistory,
    renameHonor,
    getHonorLayout,
    setHonorLayout,
    getHonorDisplayLayout
};
