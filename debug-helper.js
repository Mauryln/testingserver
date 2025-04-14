// Archivo auxiliar para depuración de IDs y números de WhatsApp
// Este archivo puede ayudarte a entender la estructura de los objetos de WhatsApp Web.js

// Función para depurar un contacto o participante
async function debugWhatsAppContact(client, contactId) {
    try {
      console.log(`🔍 Depurando contacto con ID: ${contactId}`)
  
      // Obtener el contacto
      const contact = await client.getContactById(contactId)
  
      // Mostrar toda la información disponible
      console.log("📱 Información del contacto:")
      console.log("- ID serializado:", contact.id._serialized)
      console.log("- ID de usuario:", contact.id.user)
      console.log("- Nombre:", contact.name || "No disponible")
      console.log("- Pushname:", contact.pushname || "No disponible")
      console.log("- Número:", contact.number || "No disponible")
      console.log("- Número corto:", contact.shortName || "No disponible")
      console.log("- Es contacto de la agenda:", contact.isMyContact)
      console.log("- Es grupo:", contact.isGroup)
      console.log("- Es empresa:", contact.isBusiness)
  
      // Mostrar métodos disponibles
      console.log("🛠️ Métodos disponibles:")
      console.log("- getProfilePicUrl()")
      console.log("- getChat()")
      console.log("- getFormattedNumber()")
  
      // Intentar obtener el número formateado
      try {
        const formattedNumber = await contact.getFormattedNumber()
        console.log("📞 Número formateado:", formattedNumber)
      } catch (err) {
        console.log("❌ Error al obtener número formateado:", err.message)
      }
  
      return contact
    } catch (error) {
      console.error("❌ Error al depurar contacto:", error)
      return null
    }
  }
  
  // Función para depurar un grupo
  async function debugWhatsAppGroup(client, groupId) {
    try {
      console.log(`🔍 Depurando grupo con ID: ${groupId}`)
  
      // Obtener el chat del grupo
      const chat = await client.getChatById(groupId)
  
      if (!chat.isGroup) {
        console.log("❌ El ID proporcionado no corresponde a un grupo")
        return null
      }
  
      // Mostrar información del grupo
      console.log("👥 Información del grupo:")
      console.log("- Nombre:", chat.name)
      console.log("- ID:", chat.id._serialized)
      console.log("- Descripción:", chat.description || "No disponible")
      console.log("- Creado por:", chat.owner?.user || "Desconocido")
      console.log("- Cantidad de participantes:", chat.participants.length)
  
      // Mostrar los primeros 5 participantes
      console.log("👤 Primeros participantes:")
      for (let i = 0; i < Math.min(5, chat.participants.length); i++) {
        const participant = chat.participants[i]
        console.log(`- Participante ${i + 1}:`)
        console.log("  * ID:", participant.id._serialized)
        console.log("  * ID de usuario:", participant.id.user)
        console.log("  * Es administrador:", participant.isAdmin)
        console.log("  * Es superadmin:", participant.isSuperAdmin)
  
        // Intentar obtener más información del participante
        try {
          const contact = await client.getContactById(participant.id._serialized)
          console.log("  * Nombre:", contact.name || contact.pushname || "No disponible")
          console.log("  * Número:", contact.number || "No disponible")
        } catch (err) {
          console.log("  * Error al obtener detalles:", err.message)
        }
      }
  
      return chat
    } catch (error) {
      console.error("❌ Error al depurar grupo:", error)
      return null
    }
  }
  
  // Exportar las funciones para uso en el servidor
  module.exports = {
    debugWhatsAppContact,
    debugWhatsAppGroup,
  }
  