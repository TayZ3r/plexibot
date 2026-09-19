const client = require('../../../index');

client.on("interactionCreate", async (interaction) => {
    if (interaction.isAutocomplete()) {
        const cmd = client.commands.get(interaction.commandName);
        if (cmd?.autocomplete) {
            await cmd.autocomplete(client, interaction).catch(console.error);
        }
        return;
    }

    if (interaction.isChatInputCommand()) {
        const cmd = client.commands.get(interaction.commandName);

        await interaction.deferReply({ephemeral: Boolean(cmd?.ephemeral)}).catch(() => {
        });

        if (!cmd) return interaction.followUp({content: "Une erreur est survenue."});

        const args = [];

        for (let option of interaction.options.data) {
            if (option.type === "SUB_COMMAND") {
                if (option.name) args.push(option.name);
                option.options?.forEach((x) => {
                    if (x.value) args.push(x.value);
                });
            } else if (option.value) args.push(option.value);
        }
        interaction.member = interaction.guild.members.cache.get(interaction.user.id);

        cmd.run(client, interaction, args);
    }
});