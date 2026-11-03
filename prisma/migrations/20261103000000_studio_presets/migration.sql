CREATE TABLE "StudioPreset" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StudioPreset_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StudioPreset_workspaceId_id_key" ON "StudioPreset"("workspaceId", "id");
CREATE UNIQUE INDEX "StudioPreset_workspaceId_name_key" ON "StudioPreset"("workspaceId", "name");
ALTER TABLE "StudioPreset" ADD CONSTRAINT "StudioPreset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
