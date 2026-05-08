import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import * as api from "@/hooks/use-api";

function SkillEditor({ skill, onSave, onCancel }) {
  const [name, setName] = useState(skill?.name || "");
  const [description, setDescription] = useState(skill?.description || "");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const isNew = !skill;

  useEffect(() => {
    if (skill) {
      setLoading(true);
      api
        .fetchSkillContent(skill.name)
        .then((data) => {
          setContent(data.content || "");
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [skill]);

  const handleSave = async () => {
    if (isNew) {
      await api.createSkill({ name, description, content });
    } else {
      await api.updateSkillContent(skill.name, content);
    }
    onSave();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <label className="text-[13px] text-(--text-muted) w-20 shrink-0">
          名称
        </label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!isNew}
          placeholder="my-skill"
          className="flex-1 h-8 text-[13px]"
        />
      </div>
      {isNew && (
        <div className="flex items-center gap-3">
          <label className="text-[13px] text-(--text-muted) w-20 shrink-0">
            描述
          </label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Skill description..."
            className="flex-1 h-8 text-[13px]"
          />
        </div>
      )}
      <div>
        <label className="text-[13px] text-(--text-muted) mb-1.5 block">
          SKILL.md 内容
        </label>
        {loading ? (
          <div className="text-[12px] text-(--text-muted) py-4 text-center">
            加载中...
          </div>
        ) : (
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="min-h-[200px] text-[13px] font-mono"
            placeholder="---&#10;name: my-skill&#10;description: ...&#10;---&#10;&#10;Skill instructions..."
          />
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} className="text-[13px]">
          取消
        </Button>
        <Button
          onClick={handleSave}
          disabled={loading || !content || (isNew && !name)}
          className="text-[13px]"
        >
          {isNew ? "创建" : "保存"}
        </Button>
      </div>
    </div>
  );
}

function ViewDialog({ skill, open, onOpenChange }) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && skill) {
      setLoading(true);
      api
        .fetchSkillContent(skill.name)
        .then((data) => {
          setContent(data.content || "");
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [open, skill]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{skill?.name} - 内容预览</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="text-[12px] text-(--text-muted) py-4 text-center">
            加载中...
          </div>
        ) : (
          <pre className="text-[13px] whitespace-pre-wrap break-all bg-(--bg-secondary) rounded-lg p-3 max-h-[400px] overflow-y-auto font-mono">
            {content}
          </pre>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="text-[13px]"
          >
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SkillPanel() {
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | skill object | 'new'
  const [viewSkill, setViewSkill] = useState(null);

  const loadSkills = useCallback(async () => {
    try {
      const list = await api.fetchSkills();
      setSkills(Array.isArray(list) ? list : []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const handleToggle = async (name, enabled) => {
    await api.toggleSkill(name, enabled);
    loadSkills();
  };

  const handleDelete = async (name) => {
    await api.deleteSkill(name);
    loadSkills();
  };

  const handleSave = () => {
    setEditing(null);
    loadSkills();
  };

  const scopeLabel = (scope) => {
    if (scope === "builtin") return "内置";
    if (scope === "global") return "全局";
    return "项目";
  };

  if (loading)
    return (
      <div className="text-[12px] text-(--text-muted) py-4 text-center">
        加载中...
      </div>
    );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <Button
          onClick={() => setEditing("new")}
          size="xs"
        >
          + 添加技能
        </Button>
      </div>

      {editing && (
        <>
          <Separator className="bg-(--border-default)" />
          <SkillEditor
            skill={editing === "new" ? null : editing}
            onSave={handleSave}
            onCancel={() => setEditing(null)}
          />
          <Separator className="bg-(--border-default)" />
        </>
      )}

      {skills.length === 0 && !editing && (
        <div className="text-[12px] text-(--text-muted) py-4 text-center">
          暂无技能
        </div>
      )}

      <div
        className="space-y-1.5 max-h-[320px] overflow-y-auto pr-1"
        style={{ scrollbarWidth: "thin" }}
      >
        {skills.map((skill) => (
          <div
            key={skill.name}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-(--border-default) bg-(--bg-secondary) group"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-(--text-primary) truncate">
                  {skill.name}
                </span>
                <Badge
                  variant={skill.scope === "builtin" ? "secondary" : "outline"}
                  className="text-[10px] px-1.5 py-0 h-4"
                >
                  {scopeLabel(skill.scope)}
                </Badge>
                {skill.version && skill.version !== "0.0.0" && (
                  <span className="text-[10px] text-(--text-muted)">
                    v{skill.version}
                  </span>
                )}
              </div>
              {skill.description && (
                <div className="text-[11px] text-(--text-muted) truncate mt-0.5">
                  {skill.description}
                </div>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {skill.scope !== "builtin" && (
                <label className="flex items-center gap-1 cursor-pointer text-[12px] text-(--text-muted)">
                  <input
                    type="checkbox"
                    checked={skill.enabled !== false}
                    onChange={(e) => handleToggle(skill.name, e.target.checked)}
                    className="accent-blue-500"
                  />
                  启用
                </label>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setViewSkill(skill)}
                className="text-[11px] h-6 px-2"
              >
                查看
              </Button>
              {skill.scope !== "builtin" && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(skill)}
                    className="text-[11px] h-6 px-2"
                  >
                    编辑
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (confirm(`确定删除技能 "${skill.name}"？`))
                        handleDelete(skill.name);
                    }}
                    className="text-[11px] h-6 px-2 text-red-500 hover:text-red-400"
                  >
                    删除
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <ViewDialog
        skill={viewSkill}
        open={!!viewSkill}
        onOpenChange={(open) => {
          if (!open) setViewSkill(null);
        }}
      />
    </div>
  );
}
