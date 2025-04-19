const { Router, dispatch } = require("./spec/hyperdispatch");
const b4a = require("b4a");
const z32 = require("z32");
class SyncBaseRouter {
  constructor(syncBase, validator) {
    this.syncBase = syncBase;
    this.validator = validator;
    this.router = new Router();
    this.dispatch = dispatch;

    // Server Operations
    this.router.add("@server/create-server", async (data, context) => {
      const { view } = context;
      // Check if server already exists
      const server = await view.findOne("@server/server", {});
      if (server) {
        console.warn("Server already exists");
        return true;
      }

      const stringifyPubKey = b4a.toString(context.signer, "hex");
      if (!stringifyPubKey || !data || !data.id || !data.name) {
        console.warn("Invalid server data or signer pub key");
        return false;
      }

      try {
        const server = {
          id: data.id,
          name: data.name,
          createdAt: data?.createdAt.toString() || Date.now().toString(),
          description: data?.description || "",
          avatar: data?.avatar || "",
        };
        await view.insert("@server/server", server);
        await view.flush();
      } catch (error) {
        console.error("Error creating server:", error);
        return false;
      }

      try {
        const adminUser = {
          id: stringifyPubKey,
          publicKey: stringifyPubKey,
          username: "User",
          joinedAt: Date.now(),
          inviteCode: "founder",
          avatar: "1",
          status: "Chilling",
        };
        await view.insert("@server/user", adminUser);
        await view.flush();
      } catch (error) {
        console.error("Error creating init user:", error);
        return false;
      }

      try {
        const role = {
          userId: stringifyPubKey,
          serverId: data.id,
          updatedBy: stringifyPubKey,
          updatedAt: Date.now(),
          role: "OWNER",
        };
        await view.insert("@server/role", role);
        await view.flush();
      } catch (error) {
        console.error("Error creating init role:", error);
        return false;
      }
      return true;
    });

    this.router.add("@server/update-server", async (data, context) => {
      const { view } = context;
      const existing = await view.findOne("@server/server", { id: data.id });
      try {
        await view.delete("@server/server", { key: data.id });
        await view.insert("@server/server", {
          ...existing,
          id: data.id,
          name: data.name || "A chat server",
          description: data.description || "",
          avatar: data.avatar || "",
        });
        await view.flush();
        return true;
      } catch (error) {
        console.log(error);
      }
    });

    // Channel Operations
    this.router.add("@server/create-channel", async (data, context) => {
      const { view } = context;

      // First check if channel already exists by channelId (primary condition)
      const existingChannelById = await view.get("@server/channel", {
        channelId: data.channelId,
      });

      if (existingChannelById?.channelId === data.channelId) {
        console.log(
          `Channel with id ${data.channelId} already exists - skipping creation`
        );
        return true; // Not an error, just skip
      }

      // Check if the channel name is already taken in this server
      const existingChannelByName = await view.get("@server/channel", {
        name: data.name,
      });

      if (existingChannelByName?.name === data.name) {
        console.log(
          `Channel with name "${data.name}" already exists - considering success`
        );
        return true; // Consider it successful
      }

      const newChannel = {
        id: data.id,
        channelId: data.channelId,
        name: data.name,
        type: data.type,
        createdAt: data.createdAt,
        createdBy: data.createdBy,
        description: data.description || "",
        position: data.position,
      };

      try {
        await view.insert("@server/channel", newChannel);
        await view.flush();
        return true;
      } catch (error) {
        console.log("Error inserting channel:", error.message);
        return false;
      }
    });

    this.router.add("@server/update-channel", async (data, context) => {
      const { view } = context;
      await view.delete("@server/channel", { channelId: data.channelId });
      await view.insert("@server/channel", {
        ...data,
        updatedAt: data.timestamp,
      });
      await view.flush();
    });

    this.router.add("@server/delete-channel", async (data, context) => {
      const { view } = context;
      await view.delete("@server/channel", { channelId: data.channelId });
      await view.flush();
    });

    // Message Operations
    this.router.add("@server/send-message", async (data, context) => {
      const { view, base, authorKey, signer } = context;

      try {
        // Check if channel exists
        const channel = await view.get("@server/channel", {
          channelId: data.channelId,
        });

        if (!channel) {
          console.log(
            `Cannot send message: Channel ${data.channelId} does not exist`
          );
          return false; // Cannot send message to non-existent channel
        }

        // Ensure the sender is acknowledged as a writer (fixes one-way sync issues)
        if (authorKey && base) {
          try {
            // Safely check if already a writer
            const isWriter =
              base.writers &&
              Array.isArray(base.writers) &&
              base.writers.some(
                (w) => w && w.key && authorKey && b4a.equals(w.key, authorKey)
              );

            if (!isWriter && authorKey) {
              console.log(
                `Message handler: Acknowledging writer ${b4a.toString(
                  authorKey,
                  "hex"
                )}`
              );
              if (typeof base.addWriter === "function") {
                await base.addWriter(authorKey, { indexer: true });
              }
            }
          } catch (err) {
            console.warn(
              `Error acknowledging writer in message handler: ${err.message}`
            );
            // Continue anyway - don't block message sending due to writer acknowledgment issues
          }
        }

        // Validate message structure
        if (!data.id || !data.content || !data.author) {
          console.log("Invalid message data structure");
          return false;
        }

        const messageData = {
          id: data.id,
          channelId: data.channelId,
          content: data.content,
          author: data.author,
          timestamp: data.timestamp,
          attachments: data.attachments || [],
        };

        // Insert message
        await view.insert("@server/message", messageData);
        await view.flush();

        // For high-volume situations, force an update to ensure propagation
        if (base && typeof base.update === "function") {
          base
            .update()
            .catch((err) =>
              console.warn(`Error updating base after message: ${err.message}`)
            );
        }

        return true;
      } catch (error) {
        console.error("Error sending message:", error.message);
        return false;
      }
    });

    this.router.add("@server/edit-message", async (data, context) => {
      const { view } = context;
      await view.delete({ id: data.id, channelId: data.channelId });
      await view.insert("@server/message", data);
      await view.flush();
    });

    this.router.add("@server/delete-message", async (data, context) => {
      const { view } = context;
      await view.delete("@server/message", {
        id: data.id,
        channelId: data.channelId,
      });
      await view.flush();
    });

    this.router.add("@server/create-user", async (data, context) => {
      const { view } = context;
      const newUser = {
        id: data.publicKey,
        publicKey: data.publicKey,
        username: "User",
        joinedAt: Date.now(),
        inviteCode: data.inviteCode,
        avatar: "1",
        status: "Chilling",
      };
      await view.insert("@server/user", newUser);
      await view.flush();
    });

    // Role Operations
    this.router.add("@server/set-role", async (data, context) => {
      const { view } = context;
      try {
        // First try to find and delete any existing record
        await view.delete("@server/role", {
          userId: data.userId,
        });
        await view.flush();
      } catch (err) {
        // Ignore errors if record doesn't exist
        console.log(
          "No existing role record to delete, proceeding with insert"
        );
      }
      // Insert new record
      await view.insert("@server/role", {
        userId: data.userId,
        serverId: data.serverId,
        role: data.role,
        updatedAt: data.timestamp || Date.now(),
        updatedBy: data.id || "system",
      });
      await view.flush();
    });

    // Invite Operations
    this.router.add("@server/create-invite", async (data, context) => {
      const { view } = context;
      await view.insert("@server/invite", data);
      await view.flush();
    });

    this.router.add("@server/claim-invite", async (data, context) => {
      const { view, base, authorKey } = context;

      // Ensure the user is added as a writer
      if (authorKey && base) {
        try {
          // Safely check if already a writer
          const isWriter =
            base.writers &&
            Array.isArray(base.writers) &&
            base.writers.some(
              (w) => w && w.key && authorKey && b4a.equals(w.key, authorKey)
            );

          if (!isWriter && authorKey) {
            console.log(
              `Claim invite: Acknowledging writer ${b4a.toString(
                authorKey,
                "hex"
              )}`
            );
            if (typeof base.addWriter === "function") {
              await base.addWriter(authorKey, { indexer: true });
            }
          }
        } catch (err) {
          console.warn(
            `Error acknowledging writer in claim invite: ${err.message}`
          );
          // Continue anyway - don't block invite claiming due to writer acknowledgment issues
        }
      }

      try {
        await view.insert("@server/user", {
          id: data.userId,
          publicKey: data.publicKey,
          joinedAt: data.timestamp,
          inviteCode: data.inviteCode,
        });
        console.log("Added user");

        await view.insert("@server/role", {
          userId: data.userId,
          role: "MEMBER",
          serverId: data.id,
          updatedBy: data.userId,
          updatedAt: Date.now(),
        });
        console.log("Added member role");
        await view.flush();

        // Force an update to ensure writer permission changes propagate
        if (base && typeof base.update === "function") {
          base
            .update()
            .catch((err) =>
              console.warn(
                `Error updating base after claim invite: ${err.message}`
              )
            );
        }

        return true;
      } catch (error) {
        console.error("Error processing claim invite:", error.message);
        return false;
      }
    });

    // Revoke invite operation
    this.router.add("@server/revoke-invite", async (data, context) => {
      const { view } = context;

      // Find the invite to revoke
      const invite = await view.findOne("@server/invite", { code: data.code });

      if (invite) {
        // Mark invite as revoked or delete it
        // Option 1: Delete the invite
        await view.delete("@server/invite", { code: data.code });
        await view.flush();
      }
    });
  }
}

module.exports = SyncBaseRouter;
